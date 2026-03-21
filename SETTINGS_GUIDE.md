# LexiTag — Step-by-Step Settings Guide

This guide is designed for first-time users to get LexiTag 0.1.3 fully configured and performing at its max potential.

## 1. AI Providers (Activating Intelligence)
The **AI Providers** tab is where you connect LexiTag to the engines that clean your track metadata and fetch lyrics.

### Adding a Provider
1. **Model Selection**: Choose your preferred AI service (OpenAI, Google Gemini, Anthropic, or Local Ollama).
2. **API Key**: Paste your secret key from the provider's dashboard.
3. **Base URL (Optional)**: Only change this if you are using a custom endpoint or a local server like Ollama.
4. **Primary Model**: Select the specific model (e.g., `gpt-4o` or `gemini-1.5-pro`).
5. **Add Button**: Click **Add** to save the provider. 

### Managing Providers
- **Verification**: LexiTag performs a health check on each added provider automatically.
- **Switching**: Once you have multiple providers, the app will use the one you've specifically selected for your next track "Fix."

## 2. Cleanup Rules (Protecting Your Library)
This tab houses the **Discovery Engine**, the core of LexiTag's junk-removal intelligence.

### Cleanup Patterns (The Shield)
- **Global List**: This shows every pattern currently being scrubbed from your tracks. 
- **Auto-Cleanup**: When you save a track, LexiTag instantly scans all metadata (Title, Album, Genre, etc.) and purges any text that matches these patterns.

### Junk Discovery (The Candidates)
- **Discovery Engine**: When scanning your library, LexiTag flags suspicious signatures (TamilVaathi, Isaimini, etc.) that aren't yet in your rules.
- **Review Dashboard**: You will see these as "Candidates." 
  - **Approve**: Converts the candidate into a global, permanent cleanup rule. 
  - **Dismiss**: Ignores the candidate if you want that specific text to remain in your metadata.

## 3. System Config (Connections & Paths)
The **System Config** tab bridges your physical files with the LexiTag engine.

### Library Sources
- **Add Absolute Path**: Use the **Add** input to tell LexiTag where your music folder is located.
- **Docker Paths**: Since LexiTag runs in Docker, the path you add here must match your container mount. 
  - *Example*: if your docker-compose says `- /mnt/music:/app/music`, you should add **/app/music** in the UI.
- **Enabled Toggle**: You can temporarily disable a source to hide its tracks from the main view without deleting any data.

### Authentication
- **LEXITAG_AUTH_TOKEN**: If you defined this in your `.env` file, the dashboard is protected. Ensure your browser is authenticated to see the full settings panel.

---

### 🚀 Getting Started Checklist:
1.  **Add a Music Source** in System Config and click **Scan Library**.
2.  **Add an AI Provider** (like Gemini or OpenAI) to enable metadata fixing.
3.  **Review Junk Candidates** in Cleanup Rules after your first scan to build your global shield.

*Release Version: 0.1.3 (Clean Slate Release)*
