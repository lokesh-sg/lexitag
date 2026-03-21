
"""Discovery service — uses LLM to identify the 'Truth' about a song."""

import json
from .llm import chat_completion

SYSTEM_PROMPT = (
    "You are a music encyclopedia and retrieval expert. Your task is to accurately identify "
    "the original metadata for a given track, especially for Indian/International film music.\n\n"
    "1. RESEARCH: Identify the TRUE Original Movie (Album Name), TRUE Lead Singers (Artist), "
    "and TRUE Composer for this song.\n"
    "   - 'Album' MUST ONLY be the pure Movie Name. Remove suffixes like 'OST' or 'Original Motion Picture Soundtrack'.\n"
    "   - CRITICAL: Verify the language. Ensure the song title language matches the movie region (e.g., do not attribute a Tamil-titled song to a Kannada movie just because they share a composer).\n"
    "   - CRITICAL: Many composers (e.g., Karthik Raja, Vidyasagar) work in multiple languages. If a song is in Tamil, find the Tamil movie it belongs to.\n"
    "   - Look for the MOST COMPLETE version of the title.\n"
    "2. EVIDENCE: If a 'WEB SEARCH RESULTS' section is provided, prioritize it. Use the exact "
    "spelling for the Movie Name found in high-confidence results (like Apple Music, Spotify, or Wikipedia).\n"
    "3. FOCUS: Ignore compilation titles. Find the original film it debuted in.\n"
    "4. FORMAT: Return a JSON object with these keys: 'title', 'artist', 'album', 'composer', 'year'.\n\n"
    "Provide ONLY the JSON. No explanation."
)

async def identify_track_llm(artist: str, title: str, filename: str = "", parent_folder: str = "", search_context: str = "", on_retry: callable = None) -> dict:
    """
    Use LLM knowledge and optional search context to identify the true identity of a track.
    """
    input_info = f"Artist: {artist}\nTitle: {title}"
    if filename:
        input_info += f"\nFilename: {filename}"
    if parent_folder:
        input_info += f"\nParent Folder: {parent_folder}"
        
    user_msg = f"Please identify the correct metadata for this track:\n{input_info}"
    if search_context:
        user_msg = f"{search_context}\n\n{user_msg}"

    print(f"[discovery] Identifying track: {title} by {artist} (Folder: {parent_folder})")
    try:
        response = await chat_completion(
            system_prompt=SYSTEM_PROMPT,
            user_message=user_msg,
            temperature=0.0,
            max_tokens=512,
            on_retry=on_retry
        )
        
        # Robust JSON extraction
        import re
        text = response.strip()
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1:
            json_str = text[start:end+1]
            print(f"[discovery] Result: {json_str}")
            return json.loads(json_str)
        return {}
    except Exception as e:
        print(f"[discovery] Identification failed: {e}")
        return {}
