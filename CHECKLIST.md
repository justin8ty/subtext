## Updated Implementation Checklist (Python + Textual)

### Core Stack
- [x] Python
- [ ] Textual
- [x] yt-dlp
- [x] Google Generative AI SDK

### TUI (Textual)
- [ ] Single-screen layout
- [ ] URL input field
- [ ] Status / progress indicators per pipeline stage
- [ ] Scrollable log/output pane
- [ ] Final summary view
- [ ] Global cancel action (keyboard-triggered)

### Task Cancellation
- [ ] Gracefully terminate yt-dlp subprocess on cancel
- [ ] Abort pending / in-flight LLM requests
- [ ] Reset UI state after cancellation
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
- [ ] Display summary in TUI
- [ ] Save summary to file (.md)
- [ ] Copy-to-clipboard support

### Error Handling & Cleanup
- [ ] Clear error states (no subtitles, API failure)
- [x] Temporary directory per run
- [ ] Guaranteed cleanup on success / failure / cancel
