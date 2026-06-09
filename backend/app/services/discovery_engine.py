import re
import time
import logging
from typing import Dict, List, Optional
from backend.app.database import get_db

logger = logging.getLogger(__name__)

class DiscoveryEngine:
    """Analyzes metadata in real-time to discover new potential junk patterns."""
    
    def __init__(self):
        self.pending_suggestions = {} # Map pattern -> {frequency, sample, field}
        self.url_regex = re.compile(r"https?://\S+|www\.\S+|\.[a-z]{2,10}/|\b[a-z0-9-]+\.(?:com|net|org|io|info|online|site|top|club|audio|music|gold|download|host|cc|ws|sh|io|ly|gd|gl|tv|link|click|social)\b", re.I)

    def analyze_track_tags(self, tags: Dict):
        """Analyze all tags of a track for candidate junk patterns (Synchronous for Scanner speed)."""
        fields_to_scan = ["comment", "composer", "title", "album", "artist", "encodedby"]
        
        for field in fields_to_scan:
            val = tags.get(field)
            if not val or not isinstance(val, str) or len(val) < 4:
                continue
                
            # 1. Look for URLs
            urls = self.url_regex.findall(val)
            for url in urls:
                self._add_candidate(url.strip(), val.strip(), field)
                
            # 2. Look for common metadata site signatures (heuristic)
            if "." in val and " " not in val:
                low_val = val.lower()
                if any(ext in low_val for ext in [".com", ".net", ".org", ".in", ".site", ".info", ".online", ".me", ".tv"]):
                    self._add_candidate(val.strip(), val.strip(), field)

    def _add_candidate(self, pattern: str, sample: str, field: str):
        """Track a candidate pattern and update its frequency in memory."""
        if len(pattern) < 3 or len(pattern) > 100:
            return

        if pattern in self.pending_suggestions:
            self.pending_suggestions[pattern]["frequency"] += 1
        else:
            self.pending_suggestions[pattern] = {
                "frequency": 1,
                "sample": sample[:200],
                "field": field
            }

    async def flush_suggestions(self):
        """Write all discovered candidates to the database asynchronously."""
        if not self.pending_suggestions:
            return
            
        db = await get_db()
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        
        logger.info(f"[discovery] Flushing {len(self.pending_suggestions)} junk candidates to database.")
        
        for pattern, data in self.pending_suggestions.items():
            try:
                # Insert or update frequency. We only update if status is still pending.
                await db.execute("""
                    INSERT INTO cleanup_suggestions (pattern, frequency, sample_value, source_field, status, created_at)
                    VALUES (?, ?, ?, ?, 'pending', ?)
                    ON CONFLICT(pattern) DO UPDATE SET 
                        frequency = frequency + excluded.frequency,
                        sample_value = excluded.sample_value
                    WHERE status = 'pending'
                """, (pattern, data["frequency"], data["sample"], data["field"], now))
            except Exception as e:
                logger.error(f"[discovery] Failed to store suggestion '{pattern}': {e}")
                
        await db.commit()
        # Reset memory state after flush
        self.pending_suggestions = {}

# Singleton instance
discovery_engine = DiscoveryEngine()
