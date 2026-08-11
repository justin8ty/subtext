# Subtext Specification

## Product

Subtext is a Windows 11, local-first terminal app for understanding a public, completed, single YouTube video without watching it.

Media acquisition, ASR, Transcript normalization, and artifact storage remain local. Only Transcript-derived text may be sent to the user-configured LLM provider.

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

The YouTube video ID is the durable identity: URL variants reuse an existing Transcript unless the user chooses Refresh in the app. A Transcript Candidate must be non-empty and plausibly cover the Source Video; needs-input, unavailable, blocked, failed, and cancelled outcomes are never presented as completed.

Translated captions, translated audio, live streams, playlists, private videos, and alternate audio tracks are excluded.

## Terminal experience

- Primary-buffer, scrollback-native rendering
- `/` opens a searchable palette: Library, Options, Help, Quit
- No workflow/configuration flag sprawl
- One active Source Video at a time
- Library and Help remain available during processing
- Additional URLs are rejected rather than queued
- Options changed during processing apply only to future work
- Library actions are contextual: print, regenerate Summary, export, open the Source Video or artifact directory, and delete with confirmation
- ASR Transcript Drafts stream into scrollback
- Cancellation leaves an explicit incomplete marker but saves no draft
- First-run setup handles LLM authentication, model selection, and ASR preparation
- Rendered timestamps link to the corresponding position in the Source Video when the terminal supports hyperlinks
- Options persist only intent-level choices: provider/model, summary detail, ASR quality, and runtime update/repair; low-level engine settings remain automatic

## Artifacts

Retain:

- Canonical `transcript.json` with timestamped segments, source metadata, and provenance
- Selected raw Caption Track when captions were used
- Current `summary.md` when available

Normalize deterministically by removing rolling-caption duplication and repairing timing, cue boundaries, and whitespace without rewriting source wording. Commit the completed Transcript and source evidence before treating acquisition as successful; commit the Summary independently so its failure never rolls back the Transcript.

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
