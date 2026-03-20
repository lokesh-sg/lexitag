
import sqlite3
from pathlib import Path

def heal():
    db_path = "lexitage.db"
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # Track 1
    # Old DB path: .../Jency Anthony, S. P. Sailaja, Malaysia Vasudevan - Aayiram Malargale Malarungal.flac
    # New Disk path: .../S. P. Sailaja, Malaysia Vasudevan, Jency - Aayiram Malargale Malarungal.flac
    new_path_1 = "/Volumes/Media/Music/UnOrganized/Various Artists/Classical Hits, Vol. 1/S. P. Sailaja, Malaysia Vasudevan, Jency - Aayiram Malargale Malarungal.flac"
    new_filename_1 = "S. P. Sailaja, Malaysia Vasudevan, Jency - Aayiram Malargale Malarungal.flac"
    
    print(f"Healing track 7951...")
    c.execute("UPDATE tracks SET path = ?, filename = ? WHERE id = 7951", (new_path_1, new_filename_1))

    # Track 2
    # Old DB path: .../K.J. Yesudas, Swarnalatha - Aaradi Chuvaruthaan.flac
    # New Disk path: .../K.J. Yesudas, Swarnalatha - Aaradi Chuvaru Thaan.flac
    new_path_2 = "/Volumes/Media/Music/UnOrganized/KJ Yesudas & P.Jayachandran Ultimate Collections/K.J. Yesudas, Swarnalatha - Aaradi Chuvaru Thaan.flac"
    new_filename_2 = "K.J. Yesudas, Swarnalatha - Aaradi Chuvaru Thaan.flac"
    
    print(f"Healing track 10546...")
    c.execute("UPDATE tracks SET path = ?, filename = ? WHERE id = 10546", (new_path_2, new_filename_2))

    conn.commit()
    print("Database healed successfully.")
    conn.close()

if __name__ == "__main__":
    heal()
