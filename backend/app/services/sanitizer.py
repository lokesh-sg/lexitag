"""Sanitizer service — uses LLM to clean junk from audio metadata."""

import json
from backend.app.services.llm import chat_completion

SYSTEM_PROMPT = (
    "You are a forensic music metadata restoration expert. Use EVERY available clue to reconstruct studio-quality metadata.\n\n"
    "0. UNIVERSAL TRUTH / DISCOVERY: If a section titled 'UNIVERSAL TRUTH / DISCOVERY' is provided, treat it as the "
    "ABSOLUTE TRUTH. It contains verified identification details for the track. Use its values for Title, Artist, "
    "Album (Movie), and Composer as the primary source of truth, even if they contradict other fields.\n\n"
    "1. CLEAN: Strip URLs (e.g., 'Masstamilan', 'Isaimini'), track numbers, and junk from ALL fields. If a field is only junk, blank it.\n\n"
    "2. DEEP CROSS-REFERENCE: Use context like 'current_filename' and 'parent_folder' to verify the track's identity. "
    "For Indian/Soundtrack music:\n"
    "- 'Album' MUST ONLY be the pure Movie Name. Strictly remove 'Original Motion Picture Soundtrack', 'OST', 'Movie', 'Songs', 'Soundtrack', or any other suffix. Mandatory Example: 'Vikram (Original Motion Picture Soundtrack)' MUST become just 'Vikram'.\n"
    "- ACCURACY: If 'UNIVERSAL TRUTH' is provided, use it exactly. If it contradicts the 'parent_folder', perform a final sanity check against the track's history. Do not change a correct movie name into an incorrect one.\n"
    "- SANITY CHECK: If the track title and artist are found in the 'parent_folder' movie name, that movie name is likely the correct Album.\n"
    "- 'Composer' must be identified accurately.\n"
    "- 'Artist' should be the primary playback singers.\n\n"
    "3. OUTPUT: Suggest a 'suggested_filename' in 'Artist - Title' format (MANDATORY). Return a valid JSON object map "
    "of all cleaned input keys plus 'suggested_filename'. Ensure no explanatory text."
)


async def sanitize_tags(tags: dict, discovery_context: str = "", on_retry: callable = None) -> dict:
    """
    Send all tag fields to the LLM for cleaning, optionally with discovery context.
    """
    # Send everything except binary indicators if any (already filtered in fixer.py)
    fields_to_clean = dict(tags)

    user_msg = json.dumps(fields_to_clean, ensure_ascii=False)
    if discovery_context:
        user_msg = f"UNIVERSAL TRUTH / DISCOVERY:\n{discovery_context}\n\n" + user_msg

    print(f"[sanitizer] Starting sanitization for {len(fields_to_clean)} fields...")
    response = await chat_completion(
        system_prompt=SYSTEM_PROMPT,
        user_message=user_msg,
        temperature=0.0,
        max_tokens=4096,
        on_retry=on_retry,
    )
    print(f"[sanitizer] LLM response received (length: {len(response)})")

    # Parse JSON response — robust extraction
    import re
    cleaned_text = response.strip()
    start = cleaned_text.find('{')
    end = cleaned_text.rfind('}')
    
    if start != -1 and end != -1 and end > start:
        json_str = cleaned_text[start:end+1]
    else:
        json_str = cleaned_text if start == -1 else cleaned_text[start:]

    if not json_str or json_str.strip() == "":
        raise RuntimeError(f"LLM returned an empty response. Raw: '{response[:100]}'")

    try:
        cleaned = json.loads(json_str)
    except json.JSONDecodeError as e:
        # Retry with a simple cleanup if it failed
        try:
            cleaned = json.loads(json_str + "}")
        except Exception:
            raise RuntimeError(f"LLM returned invalid JSON: {e}\nRaw Snip: {json_str[:200]}...")

    # Merge back: overwrite all provided keys plus capture suggested_filename
    result = dict(tags)
    for key, val in cleaned.items():
        # LLM might return keys we didn't send (like suggested_filename) or cleaned versions of what we sent
        result[key] = val
        
    return result
