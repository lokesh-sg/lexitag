# LexiTag Release Notes (v0.1.3)

## 🚀 Intelligent Metadata Discovery
- **Discovery Engine**: Implemented backend logic to automatically flag site-specific junk metadata (TamilVaathi, Isaimini, etc.) during library scans.
- **Review Dashboard**: Added a new 'Junk Discovery' section in **Settings → Cleanup Rules** to allow manual Approve/Dismiss of candidate patterns.

## 🛠️ Technical Fixes & Stability
- **Asynchronous Database**: Migrated the core database layer to 'aiosqlite' to ensure the UI remains responsive during background scans.
- **Improved Logging**: Implemented a production log filter to silence high-frequency polling (Quota, Health, Scan Progress), reducing log volume by ~90%.
- **Dependency Heal**: Synchronized all environments with missing modules (mutagen, aiosqlite, cryptography) and verified absolute venv pathing.
- **Docker Optimization**: Streamlined container configurations by removing legacy hardcoded paths in favor of dynamic library management.

---
*Release Date: March 20, 2026*
