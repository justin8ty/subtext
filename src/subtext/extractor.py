"""YouTube subtitle extraction using yt-dlp."""

from __future__ import annotations

import asyncio
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yt_dlp  # pyright: ignore[reportMissingModuleSource]


class ExtractionError(Exception):
    """Raised when subtitle extraction fails."""


@dataclass
class ExtractionResult:
    """Result of subtitle extraction."""

    video_id: str
    title: str
    uploader: str
    duration: int  # seconds
    raw_subtitles: str


async def extract_subtitles(url: str, language: str = "en") -> ExtractionResult:
    """Extract subtitles from a YouTube video.

    Args:
        url: YouTube video URL.
        language: Subtitle language code (default: "en").

    Returns:
        ExtractionResult with video metadata and raw subtitle text.

    Raises:
        ExtractionError: If extraction fails or no subtitles available.
    """
    return await asyncio.to_thread(_extract_sync, url, language)


def _extract_sync(url: str, language: str) -> ExtractionResult:
    """Synchronous extraction implementation."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        output_template = str(temp_path / "%(id)s.%(ext)s")

        ydl_opts: dict[str, Any] = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": [language],
            "subtitlesformat": "vtt",
            "outtmpl": output_template,
            "quiet": True,
            "no_warnings": True,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # type: ignore[arg-type]
                info = ydl.extract_info(url, download=True)
        except Exception as e:
            raise ExtractionError(f"Failed to extract video info: {e}") from e

        if info is None:
            raise ExtractionError("Failed to extract video info")

        video_id: str = info.get("id") or ""
        title: str = info.get("title") or "Unknown"
        uploader: str = info.get("uploader") or "Unknown"
        duration: int = info.get("duration") or 0

        # Find the subtitle file
        subtitle_file = _find_subtitle_file(temp_path, video_id, language)
        if subtitle_file is None:
            raise ExtractionError(f"No subtitles available for language '{language}'")

        raw_subtitles = subtitle_file.read_text(encoding="utf-8")

        return ExtractionResult(
            video_id=video_id,
            title=title,
            uploader=uploader,
            duration=duration,
            raw_subtitles=raw_subtitles,
        )


def _find_subtitle_file(temp_path: Path, video_id: str, language: str) -> Path | None:
    """Find the downloaded subtitle file.

    Args:
        temp_path: Temporary directory containing downloaded files.
        video_id: YouTube video ID.
        language: Subtitle language code.

    Returns:
        Path to subtitle file, or None if not found.
    """
    # yt-dlp names files as: {video_id}.{lang}.vtt
    patterns = [
        f"{video_id}.{language}.vtt",
        f"{video_id}.{language}*.vtt",
    ]

    for pattern in patterns:
        matches = list(temp_path.glob(pattern))
        if matches:
            return matches[0]

    # Fallback: any .vtt file
    vtt_files = list(temp_path.glob("*.vtt"))
    if vtt_files:
        return vtt_files[0]

    return None
