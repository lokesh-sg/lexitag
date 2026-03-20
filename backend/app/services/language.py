"""Language detection service — uses LLM to deduce ISO 639-1 language code."""

from .llm import chat_completion

SYSTEM_PROMPT = (
    "You are a language identification expert. Based on the provided song metadata "
    "and lyrics, deduce the language of the track. Return ONLY the full name of the language "
    "(e.g., 'English', 'Spanish', 'Hindi', 'Arabic', 'Japanese', 'Tamil', 'Malayalam'). "
    "Do not return anything else — no explanation, no punctuation, just the language name. "
    "If you cannot determine the language, return 'Undetermined'."
)


async def sanitize_tags(tags: dict, on_retry: callable = None) -> dict:
    """
    Send tag fields to the LLM for cleaning.
    """
    # This function's implementation is not provided in the instruction,
    # so it's left as a placeholder.
    # It should likely call chat_completion with appropriate prompts and parameters.
    raise NotImplementedError("sanitize_tags function not implemented yet.")


async def detect_language(tags: dict, lyrics: str = "", on_retry: callable = None) -> str:
    """
    Ask the LLM to deduce the track language from tags and lyrics.

    Returns:
        ISO 639-1 code (2 letters) or 'und'.
    """
    parts = []
    if tags.get("title"):
        parts.append(f"Title: {tags['title']}")
    if tags.get("artist"):
        parts.append(f"Artist: {tags['artist']}")
    if tags.get("album"):
        parts.append(f"Album: {tags['album']}")
    if tags.get("genre"):
        parts.append(f"Genre: {tags['genre']}")
    if lyrics:
        # Send first 500 chars of lyrics to keep prompt small
        parts.append(f"Lyrics (excerpt): {lyrics[:500]}")

    if not parts:
        return "und"

    user_msg = "\n".join(parts)

    response = await chat_completion(
        system_prompt=SYSTEM_PROMPT,
        user_message=user_msg,
        temperature=0.0,
        max_tokens=256,
        on_retry=on_retry,
    )
    name = response.strip().title()
    if not name or name.lower() == "und":
        return "Undetermined"
    return name
