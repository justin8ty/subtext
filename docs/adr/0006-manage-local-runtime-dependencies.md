# Manage local runtime dependencies

Subtext downloads, verifies, updates, and repairs its pinned Windows media tools, `yt-dlp`, `whisper.cpp`, and ASR models within `~/.subtext/runtime` instead of requiring global installations or modifying `PATH`. This increases application responsibility and storage use but provides a consistent app-like setup and keeps runtime changes controlled through the Options interface.
