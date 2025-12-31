"""LLM-based text summarization."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from google import genai
from openai import AsyncOpenAI

if TYPE_CHECKING:
    from subtext.config import Settings


class SummarizationError(Exception):
    """Raised when summarization fails."""


async def summarize(
    chunks: list[str],
    settings: Settings,
    cancel_event: asyncio.Event | None = None,
) -> str:
    """Summarize text chunks using configured LLM provider.

    Args:
        chunks: List of text chunks to summarize.
        settings: Application settings with API keys and model config.
        cancel_event: Optional event to signal cancellation.

    Returns:
        Final aggregated summary as markdown.

    Raises:
        SummarizationError: If LLM call fails.
        asyncio.CancelledError: If cancelled.
    """
    if not chunks:
        return ""

    # Check cancellation
    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()

    # Single chunk: summarize directly without aggregation
    if len(chunks) == 1:
        return await _summarize_chunk(chunks[0], settings, cancel_event)

    # Multiple chunks: summarize each, then aggregate
    chunk_summaries: list[str] = []

    for i, chunk in enumerate(chunks):
        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()

        summary = await _summarize_chunk(chunk, settings, cancel_event)
        chunk_summaries.append(f"Part {i + 1}:\n{summary}")

        # Rate limiting delay between calls
        if i < len(chunks) - 1 and settings.api_delay > 0:
            await asyncio.sleep(settings.api_delay)

    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()

    # Aggregate summaries
    return await _aggregate_summaries(chunk_summaries, settings, cancel_event)


async def _summarize_chunk(
    text: str,
    settings: Settings,
    cancel_event: asyncio.Event | None = None,
) -> str:
    """Summarize a single text chunk.

    Args:
        text: Text chunk to summarize.
        settings: Application settings.
        cancel_event: Optional cancellation event.

    Returns:
        Summary of the chunk.
    """
    prompt = settings.chunk_prompt.format(text=text)

    if settings.llm_provider == "openai":
        return await _call_openai(prompt, settings, cancel_event)
    else:
        return await _call_gemini(prompt, settings, cancel_event)


async def _aggregate_summaries(
    summaries: list[str],
    settings: Settings,
    cancel_event: asyncio.Event | None = None,
) -> str:
    """Aggregate chunk summaries into final summary.

    Args:
        summaries: List of chunk summaries.
        settings: Application settings.
        cancel_event: Optional cancellation event.

    Returns:
        Final aggregated summary.
    """
    combined = "\n\n".join(summaries)
    prompt = settings.aggregation_prompt.format(summaries=combined)

    if settings.llm_provider == "openai":
        return await _call_openai(prompt, settings, cancel_event)
    else:
        return await _call_gemini(prompt, settings, cancel_event)


async def _call_gemini(
    prompt: str,
    settings: Settings,
    cancel_event: asyncio.Event | None = None,
) -> str:
    """Call Gemini API.

    Args:
        prompt: Prompt to send to the model.
        settings: Application settings.
        cancel_event: Optional cancellation event.

    Returns:
        Model response text.

    Raises:
        SummarizationError: If API call fails.
    """
    if not settings.gemini_api_key:
        raise SummarizationError("GEMINI_API_KEY not configured")

    try:
        client = genai.Client(api_key=settings.gemini_api_key)

        # Run in thread to support cancellation
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=settings.gemini_model,
            contents=prompt,
        )

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()

        return response.text or ""

    except asyncio.CancelledError:
        raise
    except Exception as e:
        raise SummarizationError(f"Gemini API error: {e}") from e


async def _call_openai(
    prompt: str,
    settings: Settings,
    cancel_event: asyncio.Event | None = None,
) -> str:
    """Call OpenAI API.

    Args:
        prompt: Prompt to send to the model.
        settings: Application settings.
        cancel_event: Optional cancellation event.

    Returns:
        Model response text.

    Raises:
        SummarizationError: If API call fails.
    """
    if not settings.openai_api_key:
        raise SummarizationError("OPENAI_API_KEY not configured")

    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)

        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
        )

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()

        return response.choices[0].message.content or ""

    except asyncio.CancelledError:
        raise
    except Exception as e:
        raise SummarizationError(f"OpenAI API error: {e}") from e
