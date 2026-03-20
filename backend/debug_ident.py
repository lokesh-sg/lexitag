
import asyncio
import json
from app.services.researcher import get_track_identity_context
from app.services.sanitizer import sanitize_tags

async def debug_fix():
    # Simulate the second track in the user screenshot
    test_tags = {
        "title": "Aaradi Chuvaruthaan",
        "artist": "K.J. Yesudas, Swarnalatha",
        "album": "",
        "genre": "Tamil",
        "year": "1991"
    }
    track_name = "K.J. Yesudas, Swarnalatha - Aaradi Chuvaruthaan.mp3"
    
    # 1. Simulate researcher.py
    query = f"{test_tags['artist']} {test_tags['title']}"
    print(f"--- RESEARCHING: {query} ---")
    context = await get_track_identity_context(query)
    print(f"CONTEXT FOUND:\n{context}")
    
    # 2. Simulate sanitizer.py
    tags_to_send = {**test_tags, "current_filename": track_name}
    print(f"\n--- SANITIZING WITH CONTEXT ---")
    result = await sanitize_tags(tags_to_send, research_context=context)
    
    print(f"\nFINAL RESULT:\n{json.dumps(result, indent=2)}")

if __name__ == "__main__":
    asyncio.run(debug_fix())
