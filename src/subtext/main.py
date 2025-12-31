"""Subtext TUI - YouTube subtitle summarizer."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import ClassVar

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import (
    Button,
    Collapsible,
    Footer,
    Input,
    Label,
    RichLog,
    Static,
)

from subtext.chunker import chunk_text
from subtext.config import Settings
from subtext.extractor import ExtractionError, ExtractionResult, extract_subtitles
from subtext.processor import process_subtitles
from subtext.summarizer import SummarizationError, summarize


class StageRow(Static):
    """A single pipeline stage with status icon and message."""

    PENDING = "grey"
    RUNNING = "yellow"
    COMPLETE = "green"
    ERROR = "red"

    def __init__(self, stage_id: str, label: str, **kwargs) -> None:
        super().__init__(**kwargs)
        self.stage_id = stage_id
        self.label = label
        self.status = self.PENDING
        self._message = ""

    def compose(self) -> ComposeResult:
        with Horizontal(classes="stage-row"):
            yield Label("○", classes="stage-icon", id=f"icon-{self.stage_id}")
            yield Label(self.label, classes="stage-label")
            yield Label("", classes="stage-message", id=f"msg-{self.stage_id}")

    def set_pending(self, message: str = "") -> None:
        self.status = self.PENDING
        self._message = message
        self._update_display("○", self.PENDING, message)

    def set_running(self, message: str = "") -> None:
        self.status = self.RUNNING
        self._message = message
        self._update_display("◐", self.RUNNING, message)

    def set_complete(self, message: str = "") -> None:
        self.status = self.COMPLETE
        self._message = message
        self._update_display("●", self.COMPLETE, message)

    def set_error(self, message: str = "") -> None:
        self.status = self.ERROR
        self._message = message
        self._update_display("✕", self.ERROR, message)

    def _update_display(self, icon: str, color: str, message: str) -> None:
        icon_label = self.query_one(f"#icon-{self.stage_id}", Label)
        icon_label.update(icon)
        icon_label.styles.color = color

        msg_label = self.query_one(f"#msg-{self.stage_id}", Label)
        msg_label.update(message)


class ProgressPanel(Static):
    """Pipeline progress panel showing all stages."""

    def compose(self) -> ComposeResult:
        yield StageRow("extract", "Extract", id="stage-extract")
        yield StageRow("process", "Process", id="stage-process")
        yield StageRow("chunk", "Chunk", id="stage-chunk")
        yield StageRow("summarize", "Summarize", id="stage-summarize")


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
        margin-bottom: 1;
    }

    #url-input {
        width: 1fr;
    }

    #start-btn {
        width: 12;
        margin-left: 1;
    }

    #main-content {
        height: 1fr;
        padding: 0 1;
    }

    #progress-container {
        height: auto;
        border: solid $primary;
        padding: 1;
        margin-bottom: 1;
    }

    #progress-container > Label {
        dock: top;
        padding: 0 1;
        background: $primary;
        color: $text;
        margin-bottom: 1;
    }

    .stage-row {
        height: 1;
        margin: 0;
    }

    .stage-icon {
        width: 3;
        color: grey;
    }

    .stage-label {
        width: 12;
        text-style: bold;
    }

    .stage-message {
        width: 1fr;
        color: $text-muted;
    }

    #summary-container {
        height: 1fr;
        border: solid $secondary;
        margin-bottom: 1;
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

    #log-collapsible {
        height: auto;
        max-height: 12;
    }

    #log-collapsible > Contents {
        height: 8;
        max-height: 8;
    }

    #log {
        height: 100%;
        padding: 0 1;
    }
    """

    BINDINGS: ClassVar[list[Binding]] = [
        Binding("ctrl+x", "cancel", "Cancel"),
        Binding("ctrl+c", "quit", "Quit"),
        Binding("ctrl+l", "toggle_log", "Toggle Log"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.settings = Settings.load()
        self.cancel_event: asyncio.Event | None = None
        self.pipeline_running = False
        self.extraction_result: ExtractionResult | None = None
        self.raw_char_count = 0

    def compose(self) -> ComposeResult:
        yield Static("Subtext", id="header")
        with Horizontal(id="input-row"):
            yield Input(placeholder="Enter YouTube URL...", id="url-input")
            yield Button("Start", id="start-btn", variant="primary")
        with Vertical(id="main-content"):
            with Container(id="progress-container"):
                yield Label("Progress")
                yield ProgressPanel(id="progress-panel")
            with Container(id="summary-container"):
                yield Label("Summary")
                yield RichLog(id="summary", highlight=True, markup=True)
            with Collapsible(title="Log", collapsed=True, id="log-collapsible"):
                yield RichLog(id="log", highlight=True, markup=True)
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
        self.query_one("#stage-extract", StageRow).set_pending()
        self.query_one("#stage-process", StageRow).set_pending()
        self.query_one("#stage-chunk", StageRow).set_pending()
        self.query_one("#stage-summarize", StageRow).set_pending()

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
        self.raw_char_count = 0

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
        stage = self.query_one("#stage-extract", StageRow)
        stage.set_running("Downloading subtitles...")
        self.log_message("Extracting subtitles...")

        try:
            self.extraction_result = await extract_subtitles(
                url, self.settings.subtitle_language
            )
            self.raw_char_count = len(self.extraction_result.raw_subtitles)

            # Format: "Video Title" (12:34)
            duration = self._format_duration(self.extraction_result.duration)
            message = f'"{self.extraction_result.title}" ({duration})'
            stage.set_complete(message)

            self.log_message(
                f'Video: "{self.extraction_result.title}" '
                f"by {self.extraction_result.uploader} ({duration})"
            )
            self.log_message(f"Extracted {self.raw_char_count:,} characters")
        except Exception:
            stage.set_error("Failed")
            raise

    async def _run_processing(self) -> str:
        stage = self.query_one("#stage-process", StageRow)
        stage.set_running("Cleaning text...")
        self.log_message("Processing subtitles...")

        try:
            if self.extraction_result is None:
                raise ValueError("No extraction result")

            transcript = await asyncio.to_thread(
                process_subtitles, self.extraction_result.raw_subtitles
            )

            # Format: 5,432 → 4,210 chars
            message = f"{self.raw_char_count:,} → {len(transcript):,} chars"
            stage.set_complete(message)

            self.log_message(f"Processed to {len(transcript):,} characters")
            return transcript
        except Exception:
            stage.set_error("Failed")
            raise

    async def _run_chunking(self, transcript: str) -> list[str]:
        stage = self.query_one("#stage-chunk", StageRow)
        stage.set_running("Splitting text...")
        self.log_message("Chunking text...")

        try:
            chunks = await asyncio.to_thread(
                chunk_text,
                transcript,
                self.settings.chunk_size,
                self.settings.chunk_overlap,
            )

            # Format: 3 chunks
            message = f"{len(chunks)} chunk{'s' if len(chunks) != 1 else ''}"
            stage.set_complete(message)

            self.log_message(f"Split into {len(chunks)} chunk(s)")
            return chunks
        except Exception:
            stage.set_error("Failed")
            raise

    async def _run_summarization(self, chunks: list[str]) -> str:
        stage = self.query_one("#stage-summarize", StageRow)
        stage.set_running(f"Chunk 0/{len(chunks)}...")
        self.log_message(f"Summarizing with {self.settings.llm_provider}...")

        try:
            # Update progress as chunks are processed
            total = len(chunks)
            for i in range(total):
                if self.cancel_event and self.cancel_event.is_set():
                    raise asyncio.CancelledError()
                stage.set_running(f"Chunk {i + 1}/{total}...")
                self.log_message(f"  Processing chunk {i + 1}/{total}...")

            summary = await summarize(chunks, self.settings, self.cancel_event)

            stage.set_complete("Done")
            self.log_message("Summarization complete")
            return summary
        except Exception:
            stage.set_error("Failed")
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
            "#stage-extract",
            "#stage-process",
            "#stage-chunk",
            "#stage-summarize",
        ]:
            stage = self.query_one(stage_id, StageRow)
            if stage.status == StageRow.PENDING or stage.status == StageRow.RUNNING:
                stage.set_error("Cancelled")

    def action_cancel(self) -> None:
        """Handle cancel action (Ctrl+X)."""
        if self.cancel_event and self.pipeline_running:
            self.cancel_event.set()
            self.log_message("[yellow]Cancelling...[/yellow]")

    def action_toggle_log(self) -> None:
        """Toggle log panel visibility."""
        collapsible = self.query_one("#log-collapsible", Collapsible)
        collapsible.collapsed = not collapsible.collapsed

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
