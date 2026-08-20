# Subtext

Subtext turns a public, completed YouTube video into a trustworthy, reusable transcript and a summary for understanding the video without watching it.

## Language

**Source Video**:
A public, completed, single YouTube video identified by a submitted URL.
_Avoid_: Input video, media source

**Default Audio**:
The primary audio rendition designated by the Source Video and the only audio rendition eligible for transcription.
_Avoid_: Dub, translated audio

**Spoken Language**:
The language or languages spoken in the Default Audio, as distinct from the language of translated captions or dubbed audio.
_Avoid_: Target language, output language

**Caption Track**:
Timed text supplied by YouTube, whether creator-provided, auto-generated, or translated.
_Avoid_: Transcript, subtitle file

**Eligible Caption Track**:
A Caption Track representing the Spoken Language of the Default Audio and not produced through machine translation.
_Avoid_: Preferred subtitles, target-language captions

**Transcript Candidate**:
An Eligible Caption Track or ASR Transcript available for selection as the Transcript.
_Avoid_: Transcript source, alternative transcript

**ASR Transcript**:
Timed text generated from the Default Audio by an automatic speech-recognition model.
_Avoid_: Local Transcript, generated captions

**Transcript Draft**:
An incomplete, time-aligned record emitted while an ASR Transcript is being produced. It may remain in terminal scrollback, but it is not a Transcript and is never retained as Video Artifacts.
_Avoid_: Partial Transcript, Live Transcript

**Transcript**:
The normalized, timestamped record selected from an Eligible Caption Track or an ASR Transcript. It retains its language and provenance.
_Avoid_: Plain text, subtitles

**Transcript Provenance**:
The origin and relevant transformations of a Transcript, including whether its text came from creator-provided captions, automatic captions, or ASR.
_Avoid_: Transcript type, metadata

**Summary**:
An interpretation grounded exclusively in a Transcript that helps a user understand the Source Video and identifies supporting times. It never replaces the Transcript.
_Avoid_: Transcript, transcription

**Summary Instructions**:
Optional user-authored preferences for the focus, organization, or presentation of a Summary. They remain subordinate to Transcript-only grounding and do not alter the Transcript.
_Avoid_: System prompt, Summary prompt

**Unsummarized Transcript**:
A completed Transcript for which no current Summary is available.
_Avoid_: Failed video, incomplete Transcript

**Video Artifacts**:
The minimal durable records retained for a Source Video: its Transcript, direct source evidence, and its Summary when available. Downloaded media and processing intermediates are not Video Artifacts.
_Avoid_: Cache, working files

**Artifact Library**:
The persistent collection of Video Artifacts available across Subtext sessions.
_Avoid_: Cache directory, output folder

**App Command**:
A user-invoked application destination or action, such as Library, Options, Help, or Quit.
_Avoid_: Palette item, menu option

**Command Completion**:
The inline, editor-coupled list of App Commands shown when the user types `/`. It narrows through fuzzy matching as more text is entered and remains part of the input flow rather than covering the existing interface.
_Avoid_: Command Palette, popup, overlay
