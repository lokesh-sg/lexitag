# 1. Deployment & External Services
Never automatically execute deployment commands, push code to remote repositories, or build container images without explicit user instructions.

# 2. Source Code Protection
You must be extremely cautious with the file system. Never permanently delete (`rm`) any source code files without explicitly asking the user for permission first. If a file needs to be replaced or heavily refactored, rename the old file to `.bak` instead of deleting it.

# 3. Versioning Strategy
The project uses a strict versioning schema.
* **DO NOT** bump the Major or Minor version numbers unless instructed. 
* Use build timestamps to differentiate builds (e.g., `v0.1.5_YYYYMMDD_HHMM`).

# 4. Release Backup Protocol
Whenever you receive explicit permission to build a release version, you must execute a backup step first.
* Create a compressed archive (e.g., `.tar.gz` or `.zip`) of the current, stable source code into the local `/builds` directory.

# 5. Production Docker Image Artifact Protocol
Whenever building Docker production images for deployment:
1. **Always Cross-Compile for `amd64`**: Production images MUST be cross-compiled for `linux/amd64` using `docker buildx build --platform linux/amd64`.
2. **Include Timestamped Build Numbers**: Every generated image tarball MUST include explicit date/time build numbers to properly differentiate releases (e.g. `lexitag_v0.1.5_20260821_2233_amd64.tar`).
3. **Always Copy to Volume Destination**: Always copy the generated `amd64` tarball to `/Volumes/Downloads-1/LexiTag/` with both the timestamped filename and `lexitag_v0.1.5_latest_amd64.tar`.