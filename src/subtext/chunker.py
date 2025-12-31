"""Text chunking for LLM processing."""

import re


def chunk_text(
    text: str,
    chunk_size: int = 8000,
    overlap: int = 200,
) -> list[str]:
    """Split text into overlapping chunks.

    Attempts to split at sentence boundaries when possible.

    Args:
        text: Cleaned transcript text.
        chunk_size: Maximum characters per chunk.
        overlap: Characters to overlap between chunks.

    Returns:
        List of text chunks.
    """
    if not text.strip():
        return []

    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0

    while start < len(text):
        # Calculate end position
        end = start + chunk_size

        # If this is the last chunk, take the rest
        if end >= len(text):
            chunks.append(text[start:].strip())
            break

        # Try to find a sentence boundary near the end
        chunk = text[start:end]
        break_point = _find_sentence_boundary(chunk)

        if break_point > 0:
            # Found a sentence boundary
            actual_end = start + break_point
            chunks.append(text[start:actual_end].strip())
            # Next chunk starts with overlap before the break point
            start = max(start + 1, actual_end - overlap)
        else:
            # No sentence boundary found, break at chunk_size
            chunks.append(chunk.strip())
            start = end - overlap

    return [c for c in chunks if c]  # Filter empty chunks


def _find_sentence_boundary(text: str) -> int:
    """Find the last sentence boundary in text.

    Args:
        text: Text to search for sentence boundary.

    Returns:
        Position after the sentence boundary, or 0 if not found.
    """
    # Look for sentence-ending punctuation followed by space or end
    # Search from the end, but not in the last 10% (to ensure meaningful chunks)
    min_position = len(text) // 2  # Don't break before halfway

    # Find all sentence boundaries
    pattern = r"[.!?]+[\s\n]+"
    matches = list(re.finditer(pattern, text))

    # Find the last match that's after min_position
    for match in reversed(matches):
        end_pos = match.end()
        if end_pos >= min_position:
            return end_pos

    # Try paragraph breaks as fallback
    pattern = r"\n\n+"
    matches = list(re.finditer(pattern, text))

    for match in reversed(matches):
        end_pos = match.end()
        if end_pos >= min_position:
            return end_pos

    return 0
