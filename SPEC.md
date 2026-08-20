# Subtext Specification

## Product

Subtext is a local-first terminal app for Windows 11 and Linux that helps users understand a public, completed, single YouTube video without watching it.

Media acquisition, ASR, Transcript normalization, and artifact storage remain local. Only Transcript-derived text may be sent to the user-configured LLM provider.

## Workflow

1. Launch with `subtext`.
2. Paste a YouTube URL into the focused editor.
3. Select a Transcript Candidate in this order:
   - Creator-provided Eligible Caption Track
   - Automatic Eligible Caption Track
   - ASR Transcript from Default Audio
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

- Canonical `transcript.json` with timestamped segments, source metadata, and Transcript Provenance
- Selected raw Caption Track when captions were used
- Current `summary.md` when available

Normalize deterministically by removing rolling-caption duplication and repairing timing, cue boundaries, and whitespace without rewriting source wording. Commit the completed Transcript and source evidence before treating acquisition as successful; commit the Summary independently so its failure never rolls back the Transcript.

Delete downloaded audio and processing intermediates after success. Derived Markdown, text, VTT, and SRT exports are generated on demand. A completed Transcript survives Summary failure and can be summarized later.

## Summarization

- Controlled LLM call through `pi-ai`; no autonomous agent
- Transcript-only grounding with timestamp references
- Model-chosen Markdown structure and formatting; Subtext only requires a non-empty, normally completed response
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
- npm distribution for Windows x64 and Linux x64 initially
- No telemetry
- No speaker diarization or LLM rewriting of the canonical Transcript

Public product naming and licensing remain deferred.

## Improvements

- When no Eligible Caption Track is available, immediately report that none was found and that Subtext is switching to ASR. Show this before Default Audio download and runtime preparation so the app does not appear stalled during the fallback.
- Replace the overlay palette with Command Completion below the focused editor. Typing `/` lists App Commands without covering the existing interface; additional text fuzzy-filters command names, descriptions, and search aliases. For example, `/set` matches Options through its `settings` alias.
- Add native Linux support, including managed runtime assets, process handling, external-open behavior, packaging, and platform-specific verification.

### Highest-impact improvements

1. **Clear visual hierarchy**
   - Bold app and video titles
   - Dim secondary metadata
   - Cyan accent for timestamps and active controls
   - Green/amber/red for success, warning, and failure

2. **Visible processing stages**

   ```text
   ● Inspecting video
   ✓ No eligible Caption Track found
   → Switching to local ASR
   ↓ Downloading Default Audio
   ◌ Transcribing with Whisper
   ```

   Keep one active status line instead of appearing frozen.

3. **Better Transcript presentation**

   ```text
   02:14  The transcript text starts here and wraps beneath
          the text rather than beneath the timestamp.
   ```

   Dim timestamps, highlight hyperlinks, and separate metadata from content.

4. **Render Summary Markdown**
   - Styled headings instead of literal `##`
   - Proper bullet indentation
   - Bold and inline-code styling
   - Subtle spacing between sections
   - Preserve plain-text copying

5. **Improve the URL editor**
   - Visible border or accent while focused
   - Placeholder text
   - Short contextual hint beneath it
   - Disable or visually mute it during processing

6. **Polish overlays**
   - Consistent bordered palette, Library, Options, and Help layouts
   - Selected-row background/accent
   - Better spacing and aligned descriptions
   - Library badges such as `ASR`, `CAPTIONS`, and `SUMMARY`

7. **Introduce a small design system**
   - Central theme tokens for accent, muted, success, warning, error, borders, headings
   - Reusable status, badge, section-header, and key-hint components
   - Avoid styling independently inside every view
