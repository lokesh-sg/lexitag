import re
from .llm import chat_completion

SYSTEM_PROMPT = (
    "You are a professional lyrics retrieval assistant. \n"
    "Your goal is to provide the COMPLETE, ACCURATE lyrics for the requested song. \n"
    "RULES: \n"
    "1. Provide the FULL lyrics from start to finish. Do not truncate or summarize. \n"
    "2. Return Plain Text ONLY. \n"
    "3. No timestamps, no brackets, no conversational filler. \n"
    "4. If you cannot find the lyrics on the web after searching, output exactly LYRICS_NOT_FOUND."
)

def validate_lyrics(text: str) -> bool:
    """
    Strict validation to catch hallucinations, repetition loops, and short responses.
    """
    if not text or "LYRICS_NOT_FOUND" in text:
        return False
        
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    
    # 1. Length Check: Minimum 3 lines
    if len(lines) < 3:
        print(f"[lyrics_llm] Validation failed: Response too short ({len(lines)} lines)")
        return False
        
    # 2. Repetition Check: Catch loops (e.g. same line > 4 times consecutively)
    consecutive_count = 1
    for i in range(1, len(lines)):
        if lines[i] == lines[i-1]:
            consecutive_count += 1
            if consecutive_count > 4:
                print(f"[lyrics_llm] Validation failed: Repetition loop detected at '{lines[i][:30]}...'")
                return False
        else:
            consecutive_count = 1
            
    return True

async def fetch_lyrics_llm(artist: str, title: str, album: str = "", on_retry: callable = None) -> str:
    """
    Fetch lyrics using Gemini with Google Search Grounding.
    """
    if not artist or not title:
        return ""

    # Clean movie name
    clean_album = re.sub(r'\(.*?\)', '', album).strip() if album else ""
    
    # Ask the LLM to search for the specific track
    user_msg = f"Search Google for the full lyrics to the song '{title}' by '{artist}' from the movie '{clean_album}'."
    print(f"[lyrics_llm] Grounded Request: {user_msg}")
    
    # Enable Google Search Grounding tool
    tools = [{"google_search": {}}]

    try:
        lyrics = await chat_completion(
            system_prompt=SYSTEM_PROMPT,
            user_message=user_msg,
            temperature=0.0,
            max_tokens=2048,
            on_retry=on_retry,
            tools=tools
        )
        
        cleaned = lyrics.strip()
        print(f"[lyrics_llm] RAW LLM Response:\n---\n{cleaned[:500]}...\n---")
        
        if "LYRICS_NOT_FOUND" in cleaned:
            print(f"[lyrics_llm] LLM reported LYRICS_NOT_FOUND")
            return ""

        # Apply anti-hallucination/anti-loop check
        if validate_lyrics(cleaned):
            print(f"[lyrics_llm] Validation successful")
            return cleaned
        else:
            print(f"[lyrics_llm] Validation failed")
            return ""
            
    except Exception as e:
        print(f"[lyrics_llm] Grounded fetch error: {e}")
        return ""
