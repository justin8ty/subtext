# Subtext Specification

## Product

Subtext is a Windows 11, local-first terminal app for understanding a public, completed, single YouTube video without watching it.

## Workflow

1. Launch with `subtext`.
2. Paste a YouTube URL into the focused editor.
3. Select a Transcript Candidate in this order:
   - Creator-provided original-language captions
   - Auto-generated original-language captions
   - Local ASR from Default Audio
4. Print the timestamped Transcript.
5. Generate and print a transcript-grounded Summary.
6. Retain reusable Video Artifacts under `~/.subtext`.

Translated captions, translated audio, live streams, playlists, private videos, and alternate audio tracks are excluded.

## Terminal experience

- Primary-buffer, scrollback-native rendering
- `/` opens a searchable palette: Library, Options, Help, Quit
- No workflow/configuration flag sprawl
- One active Source Video at a time
- Library and Help remain available during processing
- ASR Transcript Drafts stream into scrollback
- Cancellation leaves an explicit incomplete marker but saves no draft
- First-run setup handles LLM authentication, model selection, and ASR preparation

## Artifacts

Retain:

- Canonical timestamped Transcript with metadata and provenance
- Selected raw Caption Track when used
- Current Summary when available

Delete downloaded audio and processing intermediates after success. Derived Markdown, text, VTT, and SRT exports are generated on demand. A completed Transcript survives Summary failure and can be summarized later.

## Summarization

- Controlled LLM call through `pi-ai`; no autonomous agent
- Transcript-only grounding with timestamp references
- Overview, chapters, claims, examples, caveats, and takeaways
- Single-pass when context permits; hierarchical summarization otherwise
- Tested envelope: one to six hours
- No RAG or interactive Q&A in v1

## Implementation

- Node 24, TypeScript, ESM
- `@earendil-works/pi-tui`
- `@earendil-works/pi-ai`
- `yt-dlp` process adapter
- `whisper.cpp` process adapter
- Quantized `large-v3-turbo` balanced profile; `large-v3` accurate profile
- Managed binaries/models under `~/.subtext/runtime`
- Pi-compatible credentials under `~/.subtext/auth.json`
- npm distribution initially
- No telemetry
- No speaker diarization or LLM rewriting of the canonical Transcript

Public product naming and licensing remain deferred.
