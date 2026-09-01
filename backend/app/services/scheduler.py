"""Periodic Auto-Scan Background Scheduler for LexiTag."""

import asyncio
import logging
import time
from datetime import datetime, timezone
from backend.app.database import get_db, get_setting, set_setting

logger = logging.getLogger("lexitag.scheduler")

PRESET_INTERVALS = {
    "1h": 3600,
    "6h": 21600,
    "12h": 43200,
    "24h": 86400,
    "7d": 604800,
}


class AutoScanScheduler:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._running = False
        self._enabled = False
        self._interval = "24h"
        self._custom_minutes = 60
        self._last_scan_ts = 0.0

    async def initialize(self):
        """Load settings from database and initialize scheduler state."""
        try:
            enabled_val = await get_setting("auto_scan_enabled", "0")
            self._enabled = enabled_val == "1"
            self._interval = await get_setting("auto_scan_interval", "24h")
            
            try:
                self._custom_minutes = int(await get_setting("auto_scan_custom_minutes", "60"))
            except ValueError:
                self._custom_minutes = 60

            try:
                self._last_scan_ts = float(await get_setting("last_auto_scan_ts", "0.0"))
            except ValueError:
                self._last_scan_ts = 0.0

            logger.info(
                f"AutoScanScheduler initialized: enabled={self._enabled}, "
                f"interval={self._interval}, custom_minutes={self._custom_minutes}"
            )
        except Exception as e:
            logger.error(f"Failed to initialize AutoScanScheduler: {e}")

    def get_interval_seconds(self) -> int:
        """Calculate total interval seconds based on current configuration."""
        if self._interval in PRESET_INTERVALS:
            return PRESET_INTERVALS[self._interval]
        elif self._interval == "custom":
            return max(60, self._custom_minutes * 60)
        return 86400  # Default 24h

    async def get_status(self) -> dict:
        """Return current scheduler status and countdown."""
        interval_secs = self.get_interval_seconds()
        now = time.time()
        
        # Check active scans in tracks router
        is_scanning = False
        try:
            from backend.app.routers.tracks import _active_scan_tasks
            is_scanning = bool(_active_scan_tasks)
        except Exception:
            pass

        next_scan_in = None
        if self._enabled:
            elapsed = now - self._last_scan_ts
            remaining = max(0, interval_secs - elapsed)
            next_scan_in = int(remaining)

        last_scan_iso = None
        if self._last_scan_ts > 0:
            last_scan_iso = datetime.fromtimestamp(self._last_scan_ts, timezone.utc).isoformat()

        return {
            "enabled": self._enabled,
            "interval": self._interval,
            "custom_minutes": self._custom_minutes,
            "interval_seconds": interval_secs,
            "last_scan": last_scan_iso,
            "next_scan_in_seconds": next_scan_in,
            "is_scanning": is_scanning,
        }

    async def update_config(self, enabled: bool, interval: str, custom_minutes: int | None = None) -> dict:
        """Update scheduler configuration and persist to database."""
        self._enabled = bool(enabled)
        if interval in PRESET_INTERVALS or interval == "custom":
            self._interval = interval
        if custom_minutes is not None:
            self._custom_minutes = max(1, int(custom_minutes))

        await set_setting("auto_scan_enabled", "1" if self._enabled else "0")
        await set_setting("auto_scan_interval", self._interval)
        await set_setting("auto_scan_custom_minutes", str(self._custom_minutes))

        logger.info(
            f"AutoScanScheduler config updated: enabled={self._enabled}, "
            f"interval={self._interval}, custom_minutes={self._custom_minutes}"
        )
        return await self.get_status()

    async def _loop(self):
        """Background loop that evaluates timers every 30 seconds."""
        # Initial wait to let server finish starting up
        await asyncio.sleep(5)
        await self.initialize()

        while self._running:
            try:
                if self._enabled:
                    interval_secs = self.get_interval_seconds()
                    now = time.time()
                    elapsed = now - self._last_scan_ts

                    if elapsed >= interval_secs:
                        # Check if a scan is already in progress
                        from backend.app.routers.tracks import _active_scan_tasks, scan_library
                        if not _active_scan_tasks:
                            logger.info("AutoScanScheduler: Triggering scheduled automated library scan...")
                            self._last_scan_ts = now
                            await set_setting("last_auto_scan_ts", str(now))
                            
                            try:
                                res = await scan_library()
                                logger.info(f"AutoScanScheduler: Library scan initiated with job_id={res.get('job_id')}")
                            except Exception as scan_err:
                                logger.error(f"AutoScanScheduler: Error triggering scan_library: {scan_err}")
                        else:
                            logger.info("AutoScanScheduler: Scan skipped because an active scan is already running.")
            except Exception as e:
                logger.error(f"AutoScanScheduler loop error: {e}")

            # Sleep 30 seconds before next check
            await asyncio.sleep(30)

    def start(self):
        """Start the background scheduler task."""
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._loop())
            logger.info("AutoScanScheduler background task started")

    def stop(self):
        """Stop the background scheduler task."""
        if self._running:
            self._running = False
            if self._task:
                self._task.cancel()
                self._task = None
            logger.info("AutoScanScheduler background task stopped")


# Global singleton instance
auto_scan_scheduler = AutoScanScheduler()
