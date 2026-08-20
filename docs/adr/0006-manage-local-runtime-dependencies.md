# Manage local runtime dependencies

Subtext downloads, verifies, updates, and repairs pinned platform-specific media tools, `yt-dlp`, `whisper.cpp`, and ASR models within `~/.subtext/runtime` on Windows x64 and Linux x64 instead of requiring global installations or modifying `PATH`. This increases application responsibility and storage use but provides a consistent app-like setup and keeps runtime changes controlled through the Options interface.
