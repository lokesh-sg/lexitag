
"""Master Forensic Service — Consolidates multiple LLM calls into a single Turn."""

import json
import re
from backend.app.services.llm import chat_completion

SYSTEM_PROMPT = (
    "You are a forensic music metadata restoration expert and retrieval assistant.\n\n"
    "CRITICAL OUTPUT RULE:\n"
    "- Research and identify the track thoroughly using Google Search.\n"
    "- Once identified, you MUST provide the final metadata and lyrics in the following JSON format.\n"
    "- Ensure the JSON is the primary delivery of your findings.\n"
    "- Do not use multiple JSON blocks; only one complete object.\n\n"
    "TASK:\n"
    "1. RESEARCH: Identify the TRUE original identity of the track (Title, Artist, Album/Movie, Composer, Year, Genre).\n"
    "   - SEARCH STRATEGY: If the track 'title' in 'raw_tags' seems incomplete, misspelled, or generic, prioritize 'parent_folder' as the primary Movie/Album name to find the correct track list for that film.\n"
    "   - MOVIE PATTERNS: Look for '(From [MovieName])' or '(From _[MovieName]_)' in titles and filenames. Extract [MovieName] as the 'Album'.\n"
    "   - CLEANING: Strip 'Original Motion Picture Soundtrack', 'Original Sound Track', 'Original Soundtracks', 'Original Motion Pictures', 'Original Background Score', 'OST', 'BGM', 'Video Songs', etc. from all fields.\n"
    "   - NEGATIVES: NEVER include 'Original Motion Picture Soundtrack' or 'Original Background Score' in the 'album' or 'title' fields. 'Album' MUST ONLY be the pure Movie Name (e.g., 'Kidaari', not 'Kidaari (Original Background Score)').\n"
    "   - 'Album' MUST ONLY be the pure Movie Name.\n"
    "   - Ensure the language of the title matches the movie's region.\n"
    "2. CLEAN: Strip URLs, junk, and technical technical suffixes from all metadata.\n"
    "3. LYRICS: Retrieve the COMPLETE, ACCURATE lyrics for this song. Plain text ONLY. No timestamps.\n"
    "4. LANGUAGE: Identify the full name of the language (e.g., 'Tamil', 'Hindi', 'English').\n"
    "5. FILENAME: Suggest a 'suggested_filename' in 'Artist - Title' format.\n\n"
    "CRITICAL METADATA RULES:\n"
    "- If you see any 'Unknown artist', 'Unknown album', or 'Unknown genre' strings in the input, IGNORE THEM. This means they are placeholders and you MUST RESEARCH the TRUE values from scratch using Google Search.\n"
    "- Identify the COMPLETE artist list (multiple singers if applicable).\n"
    "- Identify the COMPSER / Music Director (e.g. 'Ilaiyaraaja', 'A.R. Rahman').\n"
    "- If you find multiple versions of a track, prioritize the Original Motion Picture or Original Studio version.\n"
    "- If you cannot find the lyrics, set 'lyrics' to 'LYRICS_NOT_FOUND'.\n"
    "- If the track is an INSTRUMENTAL (common in Jazz or Scores), set 'lyrics' to 'INSTRUMENTAL'.\n"
    "- LRYICS REPETITION: Do not repeat blocks of lyrics in a loop. If the song is very long, provide the first several verses and the chorus.\n"
    "- AVOID LISTS: Do not provide a list of all tracks in an album. Focus EXCLUSIVELY on the ONE track provided in the raw_tags/filename.\n\n"
    "OUTPUT FORMAT:\n"
    "{\n"
    "  \"metadata\": {\"title\": \"...\", \"artist\": \"...\", \"album\": \"...\", \"composer\": \"...\", \"year\": \"...\", \"genre\": \"...\"},\n"
    "  \"language\": \"...\",\n"
    "  \"suggested_filename\": \"Artist - Title\",\n"
    "  \"lyrics\": \"...\"\n"
    "}"
)

# Simple module-level cache to prevent redundant calls in the same session
_cache = {}

async def process_song_full(tags: dict, filename: str = "", parent_folder: str = "", force_lyrics: bool = False, on_retry: callable = None) -> dict:
    """
    Perform a single, consolidated LLM call for identification, sanitization, language, and lyrics.
    """
    # Create a cache key
    cache_key = f"{filename}|{tags.get('artist')}|{tags.get('title')}"
    if not force_lyrics and cache_key in _cache:
        print(f"[master_llm] Using cached result for {filename}")
        return _cache[cache_key]

    input_data = {
        "raw_tags": tags,
        "filename": filename,
        "parent_folder": parent_folder,
        "request_lyrics": force_lyrics,
        "search_context": tags.get("search_context", "") # Pass through search context if available
    }
    
    user_msg = f"Search Google and identify this song. Clean the metadata and fetch lyrics if possible:\n{json.dumps(input_data)}"
    
    # Use Google Search Grounding for high-fidelity retrieval
    tools = [{"google_search": {}}]
    
    print(f"[master_llm] Executing single-turn forensic call for '{filename}'...")
    
    import asyncio
    max_attempts = 3
    last_error = None
    
    for attempt in range(max_attempts):
        try:
            response = await chat_completion(
                system_prompt=SYSTEM_PROMPT,
                user_message=user_msg,
                temperature=0.1 if attempt > 0 else 0.0,
                max_tokens=2048, 
                on_retry=on_retry,
                tools=tools
            )
            
            # Robust JSON extraction
            text = response.strip()
            start = text.find('{')
            end = text.rfind('}')
            
            # If the JSON is truncated (no closing brace), try to repair it
            if start != -1 and end == -1:
                print(f"[master_llm] Response truncated. Attempting repair...")
                text += '"}' # Rough closure
                end = text.rfind('}')

            if start != -1 and end != -1:
                json_str = text[start:end+1]
                if "```json" in json_str:
                    json_str = json_str.replace("```json", "").replace("```", "")
            else:
                print(f"[master_llm] No JSON braces found. Falling back to brute-force text search for '{filename}'")

            try:
                if start != -1 and end != -1:
                    result = json.loads(json_str)
                else:
                    raise json.JSONDecodeError("Brute-force rescue", json_str, 0)
            except (json.JSONDecodeError, Exception):
                try:
                    meta = {}
                    for key in ["title", "artist", "album", "composer", "year", "genre"]:
                         match = re.search(fr'["\']?{key}["\']?\s*[:=]\s*["\']?([^"\',;\n]+)["\']?', json_str, re.I)
                         if match: meta[key] = match.group(1).strip().rstrip('",. \t')
                    
                    lang_match = re.search(r'["\']?language["\']?\s*[:=]\s*["\']?([^"\',;\n]+)["\']?', json_str, re.I)
                    lyr_match = re.search(r'["\']?lyrics["\']?\s*[:=]\s*(.*)', json_str, re.S | re.I)
                    
                    if meta.get("title") and meta.get("artist"):
                        result = {
                            "metadata": meta,
                            "language": lang_match.group(1).strip().rstrip('",. \t') if lang_match else "Undetermined",
                            "lyrics": lyr_match.group(1).split("}", 1)[0].replace('\\n', '\n').strip(' \n\t"\'') if lyr_match else ""
                        }
                    else:
                        raise RuntimeError("LLM provided no identifiable metadata blocks.")
                except Exception as e:
                    raise RuntimeError(f"LLM parsing failed: {e}")
            
            # Post-process to ensure LLM didn't parrot "Unknown" placeholders
            if result and "metadata" in result:
                for k in list(result["metadata"].keys()):
                    v = result["metadata"][k]
                    if isinstance(v, str):
                        low_v = v.lower()
                        if any(x in low_v for x in ["unknown artist", "unknown genre", "unknown album", "various artist", "unknown year"]):
                            result["metadata"][k] = ""
            
            # Cache the result
            if result:
                print(f"[master_llm] Fix successful for '{filename}'")
                _cache[cache_key] = result
                return result

        except Exception as e:
            last_error = str(e)
            if attempt < max_attempts - 1:
                # Is it an API error that specifically needs a pause?
                is_api_err = any(x in last_error for x in ["503", "500", "429", "Overloaded", "Unavailable", "Service"])
                wait_time = (attempt + 1) * 8 # 8s then 16s
                
                print(f"[master_llm] Attempt {attempt+1} failed: {last_error}")
                if is_api_err:
                    print(f"[master_llm] Pausing {wait_time}s to allow API recovery...")
                    if on_retry:
                        await on_retry(wait_time)
                    await asyncio.sleep(wait_time)
                else:
                    # Small delay for non-system errors
                    await asyncio.sleep(2)
            else:
                print(f"[master_llm] All {max_attempts} attempts failed for '{filename}': {last_error}")
            
    # If we get here, all attempts failed. 
    # CRITICAL: Only return a dummy if it's an identification/parsing failure.
    # If it's an API-level failure (503, 500, etc.), we MUST raise to notify the user.
    is_api_failure = any(x in last_error for x in ["503", "500", "API returned", "Overloaded", "Unavailable"])
    
    if is_api_failure:
        print(f"[master_llm] Hard API Failure detected: {last_error}")
        from backend.app.services.tagger import _log
        _log(f"MASTER LLM API FAILURE: {filename} | {last_error}")
        raise RuntimeError(f"AI API Failure: {last_error}")

    # For identification failures (chatty AI, no JSON), we Soft-Fail to allow batch completion.
    print(f"[master_llm] AI could not identify '{filename}'. Soft-failing to allow skip.")
    from backend.app.services.tagger import _log
    _log(f"SKIPPED (AI GAVE UP): {filename} | LAST ERROR: {last_error}")
    # Log the offending body for developer analysis if possible
    if 'response' in locals():
        _log(f"OFFENDING RESPONSE BODY FOR {filename}:\n---\n{response}\n---")
    
    # Return empty template so fixer.py doesn't crash and track is still processed locally
    return {
        "metadata": {},
        "language": "Undetermined",
        "suggested_filename": None,
        "lyrics": ""
    }
