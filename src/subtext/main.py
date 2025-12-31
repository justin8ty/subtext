"""Subtext TUI"""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import ClassVar

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import Button, Footer, Input, Label, RichLog, Static

from subtext.chunker import chunk_text
from subtext.config import Settings
from subtext.extractor import ExtractionError, ExtractionResult, extract_subtitles
from subtext.processor import process_subtitles
from subtext.summarizer import SummarizationError, summarize


class StageStatus(Static):
    """A single pipeline stage status indicator."""

    PENDING = "grey"
    RUNNING = "yellow"
    COMPLETE = "green"
    ERROR = "red"

    def __init__(self, label: str, **kwargs) -> None:
        super().__init__(**kwargs)
        self.label = label
        self.status = self.PENDING

    def compose(self) -> ComposeResult:
        yield Label(f"○ {self.label}", id=f"stage-{self.label.lower()}")

    def set_pending(self) -> None:
        self.status = self.PENDING
        self.query_one(Label).update(f"○ {self.label}")
        self.query_one(Label).styles.color = self.PENDING

    def set_running(self) -> None:
        self.status = self.RUNNING
        self.query_one(Label).update(f"◐ {self.label}")
        self.query_one(Label).styles.color = self.RUNNING

    def set_complete(self) -> None:
        self.status = self.COMPLETE
        self.query_one(Label).update(f"● {self.label}")
        self.query_one(Label).styles.color = self.COMPLETE

    def set_error(self) -> None:
        self.status = self.ERROR
        self.query_one(Label).update(f"✕ {self.label}")
        self.query_one(Label).styles.color = self.ERROR


class PipelineStatus(Static):
    """Pipeline stage status bar."""

    def compose(self) -> ComposeResult:
        with Horizontal(id="pipeline-stages"):
            yield StageStatus("Extract", id="status-extract")
            yield Label("→", classes="arrow")
            yield StageStatus("Process", id="status-process")
            yield Label("→", classes="arrow")
            yield StageStatus("Chunk", id="status-chunk")
            yield Label("→", classes="arrow")
            yield StageStatus("Summarize", id="status-summarize")


class SubtextApp(App):
    """Subtext TUI application."""

    TITLE = "Subtext"
    CSS = """
    Screen {
        background: $surface;
    }

    #header {
        dock: top;
        height: 3;
        content-align: center middle;
        background: $primary;
        color: $text;
        text-style: bold;
    }

    #input-row {
        dock: top;
        height: 3;
        padding: 0 1;
    }

    #url-input {
        width: 1fr;
    }

    #start-btn {
        width: 12;
        margin-left: 1;
    }

    #pipeline-stages {
        dock: top;
        height: 1;
        padding: 0 1;
        align: center middle;
    }

    .arrow {
        width: 3;
        content-align: center middle;
        color: $text-muted;
    }

    StageStatus {
        width: auto;
        padding: 0 1;
    }

    #main-content {
        height: 1fr;
    }

    #log-container {
        height: 1fr;
        border: solid $primary;
        margin: 1;
    }

    #log-container > Label {
        dock: top;
        padding: 0 1;
        background: $primary;
        color: $text;
    }

    #log {
        height: 1fr;
        padding: 0 1;
    }

    #summary-container {
        height: 1fr;
        border: solid $secondary;
        margin: 1;
    }

    #summary-container > Label {
        dock: top;
        padding: 0 1;
        background: $secondary;
        color: $text;
    }

    #summary {
        height: 1fr;
        padding: 0 1;
    }
    """

    BINDINGS: ClassVar[list[Binding]] = [
        Binding("ctrl+x", "cancel", "Cancel"),
        Binding("ctrl+c", "quit", "Quit"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.settings = Settings.load()
        self.cancel_event: asyncio.Event | None = None
        self.pipeline_running = False
        self.extraction_result: ExtractionResult | None = None

    def compose(self) -> ComposeResult:
        yield Static("Subtext", id="header")
        with Horizontal(id="input-row"):
            yield Input(placeholder="Enter YouTube URL...", id="url-input")
            yield Button("Start", id="start-btn", variant="primary")
        yield PipelineStatus()
        with Vertical(id="main-content"):
            with Container(id="log-container"):
                yield Label("Log")
                yield RichLog(id="log", highlight=True, markup=True)
            with Container(id="summary-container"):
                yield Label("Summary")
                yield RichLog(id="summary", highlight=True, markup=True)
        yield Footer()

    def on_mount(self) -> None:
        self.log_message("Ready. Enter a YouTube URL to begin.")

    def log_message(self, message: str) -> None:
        log = self.query_one("#log", RichLog)
        log.write(message)

    def show_summary(self, text: str) -> None:
        summary = self.query_one("#summary", RichLog)
        summary.clear()
        summary.write(text)

    def reset_stages(self) -> None:
        self.query_one("#status-extract", StageStatus).set_pending()
        self.query_one("#status-process", StageStatus).set_pending()
        self.query_one("#status-chunk", StageStatus).set_pending()
        self.query_one("#status-summarize", StageStatus).set_pending()

    @on(Button.Pressed, "#start-btn")
    def on_start_pressed(self) -> None:
        self.start_pipeline()

    @on(Input.Submitted, "#url-input")
    def on_url_submitted(self) -> None:
        self.start_pipeline()

    def start_pipeline(self) -> None:
        if self.pipeline_running:
            self.log_message("[yellow]Pipeline already running...[/yellow]")
            return

        url = self.query_one("#url-input", Input).value.strip()
        if not url:
            self.log_message("[red]Please enter a YouTube URL.[/red]")
            return

        self.run_pipeline(url)

    @work(exclusive=True)
    async def run_pipeline(self, url: str) -> None:
        """Run the full summarization pipeline."""
        self.pipeline_running = True
        self.cancel_event = asyncio.Event()
        self.extraction_result = None

        # Clear previous state
        self.query_one("#summary", RichLog).clear()
        self.reset_stages()
        self.log_message(f"Starting pipeline for: {url}")

        try:
            # Stage 1: Extract
            await self._run_extraction(url)
            if self.cancel_event.is_set():
                raise asyncio.CancelledError()

            # Stage 2: Process
            transcript = await self._run_processing()
            if self.cancel_event.is_set():
                raise asyncio.CancelledError()

            # Stage 3: Chunk
            chunks = await self._run_chunking(transcript)
            if self.cancel_event.is_set():
                raise asyncio.CancelledError()

            # Stage 4: Summarize
            summary = await self._run_summarization(chunks)

            # Save and display
            self._save_summary(summary)
            self.show_summary(summary)
            self.log_message("[green]Pipeline complete![/green]")

        except asyncio.CancelledError:
            self.log_message("[yellow]Pipeline cancelled.[/yellow]")
            self._mark_remaining_error()
        except (ExtractionError, SummarizationError) as e:
            self.log_message(f"[red]Error: {e}[/red]")
        except Exception as e:
            self.log_message(f"[red]Unexpected error: {e}[/red]")
        finally:
            self.pipeline_running = False
            self.cancel_event = None

    async def _run_extraction(self, url: str) -> None:
        stage = self.query_one("#status-extract", StageStatus)
        stage.set_running()
        self.log_message("Extracting subtitles...")

        try:
            self.extraction_result = await extract_subtitles(
                url, self.settings.subtitle_language
            )
            stage.set_complete()
            self.log_message(
                f'Video: "{self.extraction_result.title}" '
                f"by {self.extraction_result.uploader} "
                f"({self._format_duration(self.extraction_result.duration)})"
            )
            self.log_message(
                f"Extracted {len(self.extraction_result.raw_subtitles):,} characters"
            )
        except Exception:
            stage.set_error()
            raise

    async def _run_processing(self) -> str:
        stage = self.query_one("#status-process", StageStatus)
        stage.set_running()
        self.log_message("Processing subtitles...")

        try:
            if self.extraction_result is None:
                raise ValueError("No extraction result")

            transcript = await asyncio.to_thread(
                process_subtitles, self.extraction_result.raw_subtitles
            )
            stage.set_complete()
            self.log_message(f"Processed to {len(transcript):,} characters")
            return transcript
        except Exception:
            stage.set_error()
            raise

    async def _run_chunking(self, transcript: str) -> list[str]:
        stage = self.query_one("#status-chunk", StageStatus)
        stage.set_running()
        self.log_message("Chunking text...")

        try:
            chunks = await asyncio.to_thread(
                chunk_text,
                transcript,
                self.settings.chunk_size,
                self.settings.chunk_overlap,
            )
            stage.set_complete()
            self.log_message(f"Split into {len(chunks)} chunk(s)")
            return chunks
        except Exception:
            stage.set_error()
            raise

    async def _run_summarization(self, chunks: list[str]) -> str:
        stage = self.query_one("#status-summarize", StageStatus)
        stage.set_running()
        self.log_message(f"Summarizing with {self.settings.llm_provider}...")

        try:
            for i in range(len(chunks)):
                if self.cancel_event and self.cancel_event.is_set():
                    raise asyncio.CancelledError()
                self.log_message(f"  Processing chunk {i + 1}/{len(chunks)}...")

            summary = await summarize(chunks, self.settings, self.cancel_event)
            stage.set_complete()
            self.log_message("Summarization complete")
            return summary
        except Exception:
            stage.set_error()
            raise

    def _save_summary(self, summary: str) -> None:
        """Save summary to output directory."""
        output_dir = self.settings.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate filename
        title = "summary"
        if self.extraction_result:
            # Sanitize title for filename
            title = "".join(
                c if c.isalnum() or c in " -_" else "_"
                for c in self.extraction_result.title
            )[:50]

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{title}_{timestamp}.md"
        filepath = output_dir / filename

        # Write markdown file
        content = self._format_markdown(summary)
        filepath.write_text(content, encoding="utf-8")
        self.log_message(f"Saved to {filepath}")

    def _format_markdown(self, summary: str) -> str:
        """Format summary as markdown with metadata."""
        lines = [
            f"# {self.extraction_result.title}"
            if self.extraction_result
            else "# Summary",
            "",
        ]

        if self.extraction_result:
            lines.extend(
                [
                    f"- **Video ID:** {self.extraction_result.video_id}",
                    f"- **Uploader:** {self.extraction_result.uploader}",
                    f"- **Duration:** {self._format_duration(self.extraction_result.duration)}",
                    "",
                    "---",
                    "",
                ]
            )

        lines.append(summary)
        return "\n".join(lines)

    def _format_duration(self, seconds: int) -> str:
        """Format duration in human-readable format."""
        hours, remainder = divmod(seconds, 3600)
        minutes, secs = divmod(remainder, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{secs:02d}"
        return f"{minutes}:{secs:02d}"

    def _mark_remaining_error(self) -> None:
        """Mark remaining pending stages as error."""
        for stage_id in [
            "#status-extract",
            "#status-process",
            "#status-chunk",
            "#status-summarize",
        ]:
            stage = self.query_one(stage_id, StageStatus)
            if (
                stage.status == StageStatus.PENDING
                or stage.status == StageStatus.RUNNING
            ):
                stage.set_error()

    def action_cancel(self) -> None:
        """Handle cancel action (Ctrl+X)."""
        if self.cancel_event and self.pipeline_running:
            self.cancel_event.set()
            self.log_message("[yellow]Cancelling...[/yellow]")

    async def action_quit(self) -> None:
        """Handle quit action (Ctrl+C)."""
        if self.pipeline_running and self.cancel_event:
            self.cancel_event.set()
        self.exit()


def main() -> None:
    """Application entry point."""
    app = SubtextApp()
    app.run()


if __name__ == "__main__":
    main()
