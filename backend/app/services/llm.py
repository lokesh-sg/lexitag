"""Generic async LLM client — reads active provider from DB, calls OpenAI-compatible endpoint.

Captures rate-limit headers from responses for quota monitoring.
Handles Claude's different API format.
"""

import aiohttp
import json
import time
import asyncio
from backend.app.security import decrypt_value

_TIMEOUT = aiohttp.ClientTimeout(total=60)

# Module-level quota snapshot — updated after every LLM call
quota_info = {
    "remaining_requests": None,
    "remaining_tokens": None,
    "limit_requests": None,
    "limit_tokens": None,
    "retry_after": None,
    "retry_after_ts": None,
    "last_updated": None,
    "last_error": None,
    "provider_name": None,
    "daily_limit_reached": False,
}

# Default provider presets
PROVIDER_PRESETS = {
    "gemini": {
        "label": "Google Gemini",
        "api_base": "https://generativelanguage.googleapis.com/v1beta/openai",
        "default_model": "gemini-1.5-flash",
    },
    "openai": {
        "label": "OpenAI",
        "api_base": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
    },
    "claude": {
        "label": "Anthropic Claude",
        "api_base": "https://api.anthropic.com/v1",
        "default_model": "claude-sonnet-4-20250514",
    },
    "openrouter": {
        "label": "OpenRouter",
        "api_base": "https://openrouter.ai/api/v1",
        "default_model": "google/gemini-2.0-flash-exp:free",
    },
    "custom": {
        "label": "Custom (OpenAI-compatible)",
        "api_base": "",
        "default_model": "",
    },
}


def _parse_rate_limit_headers(headers: dict) -> None:
    """Extract x-ratelimit-* headers from the response."""
    mapping = {
        "x-ratelimit-remaining-requests": "remaining_requests",
        "x-ratelimit-remaining-tokens": "remaining_tokens",
        "x-ratelimit-limit-requests": "limit_requests",
        "x-ratelimit-limit-tokens": "limit_tokens",
    }
    for header_key, info_key in mapping.items():
        val = headers.get(header_key)
        if val is not None:
            try:
                quota_info[info_key] = int(val)
            except (ValueError, TypeError):
                pass
    quota_info["last_updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
    quota_info["last_error"] = None


def _parse_429_body(body: str) -> None:
    """Extract retryDelay from a 429 error response body."""
    try:
        data = json.loads(body)
        if isinstance(data, list):
            data = data[0]
        details = data.get("error", {}).get("details", [])
        for d in details:
            if d.get("@type", "").endswith("RetryInfo"):
                delay_str = d.get("retryDelay", "")
                if delay_str.endswith("s"):
                    seconds = float(delay_str[:-1])
                    quota_info["retry_after"] = seconds
                    quota_info["retry_after_ts"] = time.time() + seconds
        
        # Broad string-based check as fallback
        if "PerDay" in body or "DailyRequests" in body or "Daily" in body:
            quota_info["daily_limit_reached"] = True

        for d in details:
            violations = d.get("violations", [])
            for v in violations:
                qid = v.get("quotaId", "")
                if "Day" in qid:
                    quota_info["daily_limit_reached"] = True
    except Exception:
        pass


async def _get_active_provider() -> dict | None:
    """Load the active LLM provider from the database."""
    try:
        from backend.app.database import get_db
        db = await get_db()
        cursor = await db.execute("SELECT * FROM llm_providers WHERE is_active = 1 LIMIT 1")
        row = await cursor.fetchone()
        if row:
            provider_dict = dict(row)
            # Decrypt API key if it's stored
            if provider_dict.get("api_key"):
                provider_dict["api_key"] = decrypt_value(provider_dict["api_key"])
            
            # Ensure model is set, otherwise use preset default
            if not provider_dict.get("model"):
                p_type = provider_dict.get("provider")
                provider_dict["model"] = PROVIDER_PRESETS.get(p_type, {}).get("default_model", "")
            return provider_dict
    except Exception as e:
        print(f"[llm] DB provider fetch failed: {e}")

    # Fallback: try settings from env
    try:
        from backend.app.config import settings
        if settings.LLM_API_KEY:
            return {
                "id": 0,
                "provider": "gemini", # Treat env fallback as gemini by default
                "name": "Environment (.env)",
                "api_base": settings.LLM_API_BASE_URL or PROVIDER_PRESETS["gemini"]["api_base"],
                "api_key": settings.LLM_API_KEY,
                "model": settings.LLM_MODEL or PROVIDER_PRESETS["gemini"]["default_model"],
            }
    except Exception:
        pass
    return None


async def _call_gemini_native(provider: dict, system_prompt: str, user_message: str,
                              temperature: float, max_tokens: int, tools: list = None) -> str:
    """Call Google Gemini API natively."""
    model = provider.get("model", "gemini-1.5-flash")
    
    # Safety: Gemini 2.x / 2.5 models use tokens for 'thinking' (thoughts).
    # If max_tokens is too low, the model is cut off before generating content.
    if ("gemini-2" in model) and max_tokens < 512:
        max_tokens = 512

    api_key = provider.get("api_key")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{
            "parts": [{"text": f"{system_prompt}\n\nUSER INPUT: {user_message}"}]
        }],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
    }

    if tools:
        payload["tools"] = tools

    async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
        async with session.post(url, headers=headers, json=payload) as resp:
            _parse_rate_limit_headers(resp.headers)
            
            if resp.status == 429:
                body = await resp.text()
                _parse_429_body(body)
                quota_info["last_error"] = "rate_limited"
                print(f"[llm] Gemini 429 Body: {body}")
                raise RuntimeError("Gemini API (Native) returned 429 (rate limited)")

            if resp.status != 200:
                body = await resp.text()
                quota_info["last_error"] = f"http_{resp.status}"
                err_msg = f"Gemini API (Native) returned {resp.status}"
                if resp.status == 503:
                    err_msg += " (Service Unavailable/Overloaded)"
                elif resp.status == 500:
                    err_msg += " (Internal Server Error)"
                raise RuntimeError(f"{err_msg}: {body[:500]}")

            data = await resp.json()
            try:
                candidate = data.get('candidates', [{}])[0]
                content = candidate.get('content', {})
                parts = content.get('parts', [])
                
                # If parts exist, extract text
                if parts:
                    return parts[0].get('text', '').strip()
                
                # If no parts, check why
                reason = candidate.get('finishReason', 'UNKNOWN')
                if reason == 'MAX_TOKENS':
                    raise RuntimeError("Gemini cut off (MAX_TOKENS). Try increasing max tokens or switching models.")
                if reason == 'SAFETY':
                    raise RuntimeError("Gemini response blocked by safety filters.")
                
                raise RuntimeError(f"Gemini returned empty content (Reason: {reason})")
                
            except (KeyError, IndexError) as e:
                raise RuntimeError(f"Unexpected Gemini response structure: {e} | Body: {json.dumps(data)}")



async def _call_claude(provider: dict, system_prompt: str, user_message: str,
                       temperature: float, max_tokens: int) -> str:
    """Handle Claude's native API format (different from OpenAI-compatible)."""
    url = f"{provider['api_base'].rstrip('/')}/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": provider["api_key"],
        "anthropic-version": "2023-06-01",
    }
    payload = {
        "model": provider["model"],
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "temperature": temperature,
    }

    async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
        async with session.post(url, headers=headers, json=payload) as resp:
            _parse_rate_limit_headers(resp.headers)

            if resp.status == 429:
                body = await resp.text()
                _parse_429_body(body)
                quota_info["last_error"] = "rate_limited"
                raise RuntimeError("LLM API returned 429 (rate limited)")

            if resp.status != 200:
                body = await resp.text()
                quota_info["last_error"] = f"http_{resp.status}"
                err_msg = f"Anthropic API returned {resp.status}"
                if resp.status == 503:
                    err_msg += " (Service Unavailable/Overloaded)"
                elif resp.status == 500:
                    err_msg += " (Internal Server Error)"
                raise RuntimeError(f"{err_msg}: {body[:500]}")

            quota_info["retry_after"] = None
            quota_info["retry_after_ts"] = None
            data = await resp.json()

    try:
        return data["content"][0]["text"].strip()
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Unexpected Claude response: {e}")


async def _call_openai_compatible(provider: dict, system_prompt: str, user_message: str,
                                   temperature: float, max_tokens: int) -> str:
    """Call any OpenAI-compatible chat completions endpoint."""
    url = f"{provider['api_base'].rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if provider.get("api_key"):
        headers["Authorization"] = f"Bearer {provider['api_key']}"

    payload = {
        "model": provider["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
        async with session.post(url, headers=headers, json=payload) as resp:
            _parse_rate_limit_headers(resp.headers)

            if resp.status == 429:
                body = await resp.text()
                _parse_429_body(body)
                quota_info["last_error"] = "rate_limited"
                raise RuntimeError("LLM API returned 429 (rate limited)")

            if resp.status != 200:
                body = await resp.text()
                quota_info["last_error"] = f"http_{resp.status}"
                err_msg = f"LLM API returned {resp.status}"
                if resp.status == 503:
                    err_msg += " (Service Unavailable/Overloaded)"
                elif resp.status == 500:
                    err_msg += " (Internal Server Error)"
                raise RuntimeError(f"{err_msg}: {body[:500]}")

            quota_info["retry_after"] = None
            quota_info["retry_after_ts"] = None
            data = await resp.json()

    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Unexpected LLM response structure: {e}")


async def fetch_models(provider_id: int) -> list[str]:
    """Fetch available models for a specific provider from its API."""
    try:
        from backend.app.database import get_db
        db = await get_db()
        cursor = await db.execute("SELECT * FROM llm_providers WHERE id = ?", (provider_id,))
        p = await cursor.fetchone()
        if not p:
            # Check if it's the env fallback
            if provider_id == 0:
                from backend.app.config import settings
                p = {
                    "provider": "gemini",
                    "api_base": settings.LLM_API_BASE_URL or PROVIDER_PRESETS["gemini"]["api_base"],
                    "api_key": settings.LLM_API_KEY
                }
            else:
                return []
        
        from backend.app.security import decrypt_value
        p_dict = dict(p) if isinstance(p, dict) else dict(p) if type(p).__name__ == 'Row' else p
        
        provider_type = p_dict["provider"]
        api_key = p_dict.get("api_key", "")
        # If the key came from the DB it's likely encrypted, unless it's the unencrypted fallback
        if api_key and provider_id != 0:
            if api_key.startswith("gAAAA"):
                decrypted = decrypt_value(api_key)
                if not decrypted:
                    print(f"[llm] Warning: Decryption failed for provider {provider_id} key. Key might be corrupt or master key changed.")
                api_key = decrypted
            else:
                # Key is likely plaintext, use it directly (will be encrypted on next app startup)
                print(f"[llm] Using plaintext key for provider {provider_id} (not yet migrated).")
            
        if not api_key:
            print(f"[llm] Error: API key is empty for provider {provider_id} after resolution.")
            return []
            
        api_base = p_dict["api_base"].rstrip("/")

        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            if provider_type == "gemini":
                # Google Gemini Model List
                url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
                headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
                print(f"[llm] Fetching Gemini models (Key Length: {len(api_key)})")
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # We specifically want models that support generateContent
                        return [m["name"].replace("models/", "") for m in data.get("models", []) 
                                if "generateContent" in m.get("supportedGenerationMethods", [])]
                    else:
                        body = await resp.text()
                        print(f"[llm] Gemini model fetch failed with status {resp.status}: {body[:500]}")
            
            elif provider_type == "claude":
                # Anthropic doesn't have a public "list models" endpoint easily usable with API Keys
                # returning a list of known current models as fallback
                return ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"]
            
            else:
                # OpenAI Compatible
                url = f"{api_base}/models"
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # OpenAI format is usually {"data": [{"id": "model-name"}, ...]}
                        models = data.get("data", [])
                        if isinstance(models, list):
                            return [m["id"] for m in models if isinstance(m, dict) and "id" in m]
                    else:
                        body = await resp.text()
                        print(f"[llm] OpenAI model fetch failed with status {resp.status}: {body[:500]}")
        
    except Exception as e:
        print(f"[llm] Failed to fetch models for provider {provider_id}: {e}")
    
    return []


async def chat_completion(
    system_prompt: str,
    user_message: str,
    temperature: float = 0.1,
    max_tokens: int = 1024,
    retries: int = 3,
    on_retry: callable = None,
    tools: list = None,
) -> str:
    """
    Send a chat completion request using the active provider from DB.
    Falls back to .env config if no provider is configured.
    Includes automatic retry for 429 (rate limit) errors.
    """
    provider = await _get_active_provider()
    if not provider:
        raise RuntimeError("No LLM provider configured. Add one in Settings.")

    quota_info["provider_name"] = provider.get("name", "Unknown")

    for attempt in range(retries):
        try:
            if provider.get("provider") == "claude":
                return await _call_claude(provider, system_prompt, user_message, temperature, max_tokens)
            elif provider.get("provider") == "gemini":
                return await _call_gemini_native(provider, system_prompt, user_message, temperature, max_tokens, tools=tools)
            else:
                return await _call_openai_compatible(provider, system_prompt, user_message, temperature, max_tokens)
        except RuntimeError as e:
            if "429" in str(e) and attempt < retries - 1:
                # If it's a daily limit, don't even bother retrying
                if quota_info.get("daily_limit_reached"):
                    raise RuntimeError("Daily API Limit Reached. Please wait for reset or switch providers.")

                # Use retry_after if available, else exponential backoff
                wait_time = quota_info.get("retry_after") or (2 ** attempt * 2)
                print(f"[llm] Rate limited on attempt {attempt+1}. Retrying in {wait_time}s...")
                
                if on_retry:
                    try:
                        await on_retry(wait_time)
                    except Exception:
                        pass
                
                await asyncio.sleep(wait_time)
                continue
            raise e
