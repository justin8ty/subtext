"""Subtitle text processing and cleaning."""

import re


def process_subtitles(raw_vtt: str) -> str:
    """Clean raw VTT subtitle text into plain transcript.

    Args:
        raw_vtt: Raw VTT file content from extractor.

    Returns:
        Cleaned transcript text.
    """
    text = raw_vtt
    text = _remove_vtt_header(text)
    text = _remove_timestamps(text)
    text = _remove_sequence_numbers(text)
    text = _remove_tags(text)
    text = _normalize_whitespace(text)
    text = _deduplicate_lines(text)
    return text.strip()


def _remove_vtt_header(text: str) -> str:
    """Remove VTT header and metadata lines."""
    # Remove WEBVTT header and any metadata (Kind:, Language:, etc.)
    lines = text.split("\n")
    result = []
    in_header = True

    for line in lines:
        if in_header:
            # Skip header lines
            if line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
                continue
            # Empty line after header ends header section
            if line.strip() == "":
                in_header = False
                continue
        result.append(line)

    return "\n".join(result)


def _remove_timestamps(text: str) -> str:
    """Remove VTT timestamp lines (e.g., 00:00:00.000 --> 00:00:05.000)."""
    # Match timestamp lines with optional positioning info
    pattern = r"^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*$"
    return re.sub(pattern, "", text, flags=re.MULTILINE)


def _remove_sequence_numbers(text: str) -> str:
    """Remove cue sequence numbers (standalone numbers on their own line)."""
    # Match lines that are just numbers (cue identifiers)
    pattern = r"^\d+\s*$"
    return re.sub(pattern, "", text, flags=re.MULTILINE)


def _remove_tags(text: str) -> str:
    """Remove VTT and HTML tags."""
    # Remove inline timestamp tags like <00:00:00.000>
    text = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", "", text)

    # Remove VTT voice tags like <v Speaker>
    text = re.sub(r"<v\s+[^>]*>", "", text)

    # Remove common VTT tags: <c>, </c>, <b>, </b>, <i>, </i>, etc.
    text = re.sub(r"</?[cbiu](?:\.[^>]*)?>", "", text)

    # Remove any remaining HTML-like tags
    text = re.sub(r"<[^>]+>", "", text)

    return text


def _normalize_whitespace(text: str) -> str:
    """Normalize whitespace: collapse multiple spaces and blank lines."""
    # Collapse multiple spaces to single space
    text = re.sub(r"[ \t]+", " ", text)

    # Collapse multiple newlines to double newline (paragraph break)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Remove leading/trailing whitespace from each line
    lines = [line.strip() for line in text.split("\n")]

    return "\n".join(lines)


def _deduplicate_lines(text: str) -> str:
    """Remove consecutive duplicate lines (common in auto-generated subs)."""
    lines = text.split("\n")
    result = []
    prev_content = None

    for line in lines:
        stripped = line.strip()
        # Keep blank lines
        if stripped == "":
            result.append(line)
            continue
        # Skip if same as previous non-blank line
        if stripped != prev_content:
            result.append(line)
            prev_content = stripped

    return "\n".join(result)
