
import os
import struct

def heal_wav(filepath):
    print(f"Attempting to heal WAV: {filepath}")
    try:
        with open(filepath, "rb") as f:
            data = f.read(1024 * 1024) # Read first MB
            riff_pos = data.find(b"RIFF")
            if riff_pos == -1:
                print("Could not find RIFF header in first 1MB")
                return False
            
            if riff_pos == 0:
                print("File already starts with RIFF")
                return True
                
            print(f"Found RIFF at offset {riff_pos}")
            
        # Read the whole file and write it back starting from RIFF
        tmp_path = filepath + ".healed"
        with open(filepath, "rb") as f_in:
            f_in.seek(riff_pos)
            with open(tmp_path, "wb") as f_out:
                while True:
                    buf = f_in.read(1024 * 1024)
                    if not buf:
                        break
                    f_out.write(buf)
        
        os.replace(tmp_path, filepath)
        print("Heal successful!")
        return True
    except Exception as e:
        print(f"Heal failed: {e}")
        return False

if __name__ == "__main__":
    path = "/Volumes/Downloads/LexiTag/music/A.R. Rahman/Rahman Tamil Super Hit Collections/4. Kulu Kulu - (HiResTracks.com).wav"
    heal_wav(path)
