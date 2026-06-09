
import os
import sys
from pathlib import Path
from mutagen.id3 import ID3, SYLT, USLT
from mutagen.flac import FLAC
from mutagen.mp4 import MP4

# Add backend to path to import tagger
sys.path.append(str(Path(__file__).resolve().parent / "app"))
from services.tagger import write_tags

def verify_mp3(path):
    print(f"\n--- Verifying MP3: {path} ---")
    lrc = "[00:01.00]Line 1\n[00:02.00]Line 2"
    tags = {"title": "Test MP3", "artist": "Tester", "album": "Test Album", "genre": "Test", "year": "2024", "composer": ""}
    
    # 1. Write tags
    success = write_tags(path, tags, lyrics=lrc, language="eng")
    print(f"Write success: {success}")
    
    # 2. Inspect tags
    audio = ID3(path)
    sylts = audio.getall("SYLT")
    uslts = audio.getall("USLT")
    
    print(f"SYLT frames found: {len(sylts)}")
    for s in sylts:
        print(f"  SYLT Text: {s.text}")
        
    print(f"USLT frames found: {len(uslts)}")
    
    assert len(sylts) > 0, "SYLT should be present"
    assert len(uslts) == 0, "USLT should be removed"

def verify_flac(path):
    print(f"\n--- Verifying FLAC: {path} ---")
    lyrics = "Line 1\nLine 2"
    tags = {"title": "Test FLAC", "artist": "Tester", "album": "Test Album", "genre": "Test", "year": "2024", "composer": ""}
    
    # Pre-populate with non-standard tags to test removal
    audio = FLAC(path)
    audio["lyrics"] = "old"
    audio["unsyncedlyrics"] = "old"
    audio.save()
    
    # 1. Write tags
    success = write_tags(path, tags, lyrics=lyrics, language="eng")
    print(f"Write success: {success}")
    
    # 2. Inspect tags
    audio = FLAC(path)
    raw_keys = [k.upper() for k in audio.keys()]
    print(f"Normalized keys on disk (forced upper for check): {raw_keys}")
    
    assert "LYRICS" in raw_keys, "LYRICS key should be present"
    assert "UNSYNCEDLYRICS" not in raw_keys, "unsyncedlyrics should be removed"
    assert "LYRIC" not in raw_keys, "lyric should be removed"

def verify_mp4(path):
    print(f"\n--- Verifying MP4/M4A: {path} ---")
    lyrics = "Line 1\nLine 2"
    tags = {"title": "Test MP4", "artist": "Tester", "album": "Test Album", "genre": "Test", "year": "2024", "composer": ""}
    
    # Pre-populate with non-standard tags
    audio = MP4(path)
    audio["lyrics"] = ["old"]
    audio.save()
    
    # 1. Write tags
    success = write_tags(path, tags, lyrics=lyrics, language="eng")
    print(f"Write success: {success}")
    
    # 2. Inspect tags
    audio = MP4(path)
    print(f"Atoms found: {list(audio.keys())}")
    
    assert "\xa9lyr" in audio, "©lyr atom should be present"
    assert "lyrics" not in audio, "'lyrics' atom should be removed"

if __name__ == "__main__":
    # Test files (using copies to avoid corrupting user data)
    mp3_src = "/Volumes/Media/Music/UnOrganized/6. Engiruntho.mp3"
    flac_src = "/Volumes/Downloads/LexiTag/music/A.R. Rahman/Ashokan (Original Motion Picture Soundtrack)/1. Kulu Kulu Endru.flac"
    m4a_src = "/Volumes/Media/Music/UnOrganized/Aadi Maasam.m4a"
    
    tmp_mp3 = "/tmp/test.mp3"
    tmp_flac = "/tmp/test.flac"
    tmp_m4a = "/tmp/test.m4a"
    
    import shutil
    shutil.copy(mp3_src, tmp_mp3)
    shutil.copy(flac_src, tmp_flac)
    shutil.copy(m4a_src, tmp_m4a)
    
    try:
        verify_mp3(tmp_mp3)
        verify_flac(tmp_flac)
        verify_mp4(tmp_m4a)
        print("\n✅ ALL TESTS PASSED")
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
