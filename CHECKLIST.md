## Updated Implementation Checklist (Python + Textual)

### Core Stack
- [x] Python
- [x] Textual
- [x] yt-dlp
- [x] Google Generative AI SDK

### TUI (Textual)
- [x] Single-screen layout
- [x] URL input field
- [x] Status / progress indicators per pipeline stage
- [x] Scrollable log/output pane
- [x] Final summary view
- [x] Global cancel action (keyboard-triggered)
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
- [ ] Gracefully terminate yt-dlp subprocess on cancel
- [ ] Abort pending / in-flight LLM requests
- [x] Reset UI state after cancellation
- [ ] Ensure no background tasks continue running

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
- [x] Configurable chunk size, use best practices by default
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
- [ ] Clear error states (no subtitles, API failure)
- [x] Temporary directory per run
- [ ] Guaranteed cleanup on success / failure / cancel
