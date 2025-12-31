## Updated Implementation Checklist (Python + Textual)

### Core Stack
- [ ] Python
- [ ] Textual
- [ ] yt-dlp
- [ ] Google Generative AI SDK

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
- [ ] Fetch manual subtitles if available
- [ ] Fallback to auto-generated captions
- [ ] Support vtt / srt formats

### Subtitle Processing
- [ ] Remove timestamps / metadata
- [ ] Merge broken lines
- [ ] Normalize whitespace
- [ ] Deduplicate overlapping captions

### Chunking
- [ ] Token- or length-based chunking
- [ ] Configurable chunk size, use best practices by default
- [ ] Small overlap between chunks

### LLM Summarization
- [ ] Per-chunk summarization
- [ ] Final aggregation pass
- [ ] Configurable model, use Gemini by default
- [ ] Configurable summary prompt, provide initial template

### Output
- [ ] Display summary in TUI
- [ ] Save summary to file (.md)
- [ ] Copy-to-clipboard support

### Error Handling & Cleanup
- [ ] Clear error states (no subtitles, API failure)
- [ ] Temporary directory per run
- [ ] Guaranteed cleanup on success / failure / cancel
