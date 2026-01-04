## Checklist

### Core Stack
- [x] Python
- [x] Textual
- [x] yt-dlp
- [x] python-genai

### TUI (Textual)
- [x] Single-screen layout
- [x] Header / title bar
- [x] URL input field
- [x] Status / progress indicators per pipeline stage
- [x] Scrollable log/output pane
- [x] Final summary view
- [x] Settings screen (Ctrl+P → "Settings")

### Settings & Configuration
- [x] LLM provider selection (Gemini/OpenAI)
- [x] Model name configuration
- [x] API key configuration in TUI
- [x] Configurable prompts (chunk & aggregation)
- [x] Persistent settings saved to TOML config file
- [x] Single config source (TOML), env vars as optional overrides
- [x] Removed python-dotenv dependency

### Task Cancellation
- [x] Gracefully terminate yt-dlp subprocess on cancel
- [x] Abort pending / in-flight LLM requests
- [x] Reset UI state after cancellation
- [x] Stop button for cancellation
- [x] Ensure no background tasks continue running

### Subtitle Extraction
- [x] Fetch manual subtitles if available
- [x] Fallback to auto-generated captions
- [x] Support vtt / srt formats

### Subtitle Processing
- [x] Remove timestamps / metadata
- [x] Merge broken lines
- [x] Normalize whitespace
- [x] Deduplicate overlapping captions

### Chunking
- [x] Token- or length-based chunking
- [x] Configurable chunk size
- [x] Small overlap between chunks

### LLM Summarization
- [x] Per-chunk summarization
- [x] Final aggregation pass
- [x] Configurable model, use Gemini by default
- [x] Configurable summary prompt, provide initial template

### Output
- [x] Display summary in TUI
- [x] Save summary to file (.md)
- [x] Copy-to-clipboard support (Ctrl+Y)

### Error Handling & Cleanup
- [x] Temporary directory per run
- [x] Guaranteed cleanup on success / failure / cancel
