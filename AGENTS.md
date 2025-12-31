# AGENTS.md - Subtext Development Guide

This document provides guidelines for AI agents and developers working on the Subtext codebase.

## Project Overview

Subtext is a TUI-based tool for extracting YouTube subtitles and summarizing them using LLMs.

**Tech Stack:** Python 3.10+, Textual, yt-dlp, Google Generative AI / OpenAI SDK, uv

## Build, Run, and Test Commands

```bash
# Install with uv
# Don't use uv pip install
uv venv
uv add textual yt-dlp google-genai openai tiktoken python-dotenv
uv sync

# Run application
subtext                      # via entry point
python -m subtext.main       # directly

# Testing
pytest                                          # all tests
pytest tests/test_extractor.py                  # single file
pytest tests/test_extractor.py::test_func -v   # single test
pytest --cov=src/subtext                        # with coverage
pytest -k "chunker" -v                          # pattern match

# Linting & Formatting
ruff check src/              # lint
ruff check src/ --fix        # auto-fix
black src/                   # format
black src/ --check           # check only
```

## Code Style Guidelines

### Imports

Organize in three groups separated by blank lines: (1) standard library, (2) third-party, (3) local. Use absolute imports only.

```python
import asyncio
from pathlib import Path

from textual.app import App
import google.generativeai as genai

from subtext.config import Settings
```

### Formatting & Types

- **Line length**: 88 chars (Black default)
- **Quotes**: Double quotes
- **Type hints**: Required for all function signatures
- Use `|` for unions, lowercase generics (`list[str]`, not `List[str]`)

```python
async def summarize(chunks: list[str], cancel: asyncio.Event | None = None) -> str:
    ...
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions/variables | snake_case | `extract_subtitles`, `chunk_size` |
| Classes | PascalCase | `SubtitleExtractor` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_CHUNK_SIZE` |
| Private members | Leading underscore | `_internal_state` |

### Docstrings (Google-style)

```python
def process_subtitles(raw_text: str, remove_timestamps: bool = True) -> str:
    """Process raw subtitle text into clean transcript.

    Args:
        raw_text: The raw subtitle content from VTT/SRT file.
        remove_timestamps: Whether to strip timestamp lines.

    Returns:
        Cleaned transcript text with normalized whitespace.

    Raises:
        ValueError: If raw_text is empty.
    """
```

### Error Handling

- Catch specific exceptions, never bare `except:`
- Always re-raise `asyncio.CancelledError`
- Use context managers or `finally` for cleanup

```python
try:
    result = await llm_client.generate(prompt)
except asyncio.CancelledError:
    raise  # Always re-raise
except APIError as e:
    raise SummarizationError(f"Failed: {e}") from e
finally:
    await cleanup()
```

### Async Patterns

- Check cancellation at pipeline stage boundaries
- Use `asyncio.TaskGroup` for concurrent operations (Python 3.11+)

```python
async def run_pipeline(url: str, cancel: asyncio.Event) -> str:
    if cancel.is_set():
        raise asyncio.CancelledError()
    subtitles = await extract_subtitles(url)
    if cancel.is_set():
        raise asyncio.CancelledError()
    return await summarize(subtitles)
```

## Project Structure

```
subtext/
├── src/subtext/
│   ├── __init__.py      # Package init, version
│   ├── config.py        # Configuration, env loading
│   ├── extractor.py     # yt-dlp subtitle extraction
│   ├── processor.py     # Subtitle text cleaning
│   ├── chunker.py       # Text chunking logic
│   ├── summarizer.py    # LLM provider integration
│   └── main.py          # Textual TUI application
├── tests/
│   ├── conftest.py      # Shared fixtures
│   └── test_*.py        # One per module
└── pyproject.toml
```

## Testing Guidelines

- One test file per module (`test_<module>.py`)
- Descriptive names: `test_<function>_<scenario>_<expected>`
- Use `pytest-asyncio` for async tests
- Mock external services (yt-dlp, LLM APIs)
- Postpone making tests until implementation is done

```python
@pytest.mark.asyncio
async def test_summarize_cancellation():
    cancel = asyncio.Event()
    cancel.set()
    with pytest.raises(asyncio.CancelledError):
        await summarize("test", cancel_event=cancel)

@patch("subtext.summarizer.genai.GenerativeModel")
async def test_summarize_with_gemini(mock_model):
    mock_model.return_value.generate_content_async = AsyncMock(
        return_value=Mock(text="Summary")
    )
    result = await summarize("transcript")
    assert result == "Summary"
```

## Textual TUI Patterns

- Inherit from `textual.app.App`, use `compose()` for widget hierarchy
- Handle events with `on_<event>` methods or `@on` decorator
- Bind Ctrl+X to cancel, use `self.run_worker()` for background tasks
- Check cancellation at pipeline stage boundaries
- Use Textual's reactive system for state management
