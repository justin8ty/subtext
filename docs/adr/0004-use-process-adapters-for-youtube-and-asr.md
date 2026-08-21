# Use process adapters for YouTube and ASR

Watchless invokes `yt-dlp` for YouTube acquisition and `whisper.cpp` for local ASR through private process adapters rather than embedding either implementation. This provides mature Windows-compatible behavior while concentrating subprocess discovery, cancellation, updates, and diagnostics behind internal seams that can be replaced without changing the App Shell interface.
