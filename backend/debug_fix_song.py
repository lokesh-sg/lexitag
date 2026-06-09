
import asyncio
import json
from app.services.search_service import get_search_context_for_track
from app.services.discovery_llm import identify_track_llm

async def debug_fix():
    artist = "K.J. Yesudas, Swarnalatha"
    title = "Aaradi Chuvaru Thaan"
    filename = "K.J. Yesudas, Swarnalatha - Aaradi Chuvaru Thaan.flac"
    
    print(f"--- Step 1: Searching for {title} ---")
    search_context = await get_search_context_for_track(artist, title, filename)
    print("Full Search Context:")
    print(search_context)
    
    print("\n--- Step 2: Discovery via LLM ---")
    discovery_result = await identify_track_llm(artist, title, filename, search_context)
    print("Discovery Result:")
    print(json.dumps(discovery_result, indent=2))

if __name__ == "__main__":
    asyncio.run(debug_fix())
