"""Subtext - Summarize YouTube in TUI."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import ClassVar, Iterable

from textual import on, work
from textual.app import App, ComposeResult, SystemCommand
from textual.binding import Binding, BindingType
from textual.containers import Container, Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import (
    Button,
    Collapsible,
    Footer,
    Input,
    Label,
    RichLog,
    Select,
    Static,
    TextArea,
)

from subtext.chunker import chunk_text
from subtext.config import Settings
from subtext.extractor import ExtractionError, ExtractionResult, extract_subtitles
from subtext.processor import process_subtitles
from subtext.summarizer import SummarizationError, summarize


# Shared CSS for settings screens (layout only, colors from theme)
SETTINGS_SCREEN_CSS = """
    .settings-screen {
        align: center middle;
    }

    .settings-container {
        width: 90%;
        height: 90%;
        padding: 1 2;
    }

    .settings-container-small {
        width: 70;
        height: auto;
        padding: 1 1;
    }

    .settings-title {
        text-style: bold;
        text-align: center;
        width: 100%;
        padding-bottom: 1;
    }

    .settings-row {
        height: 3;
        margin-bottom: 1;
    }

    .field-label {
        width: 12;
        padding-right: 1;
    }

    .field-label-wide {
        width: 18;
        padding-right: 1;
    }

    .settings-select {
        width: 20;
    }

    .settings-input {
        width: 1fr;
    }

    .prompt-section {
        height: 1fr;
        margin-bottom: 1;
    }

    .prompt-label {
        padding-bottom: 0;
    }

    .prompt-textarea {
        height: 1fr;
    }

    .button-row {
        height: 3;
        align: center middle;
        padding-top: 1;
    }

    .save-btn {
        margin-right: 2;
    }
"""


class LLMSettingsScreen(Screen):
    """Settings screen for configuring LLM provider and API keys."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "cancel", "Cancel"),
    ]

    CSS = SETTINGS_SCREEN_CSS

    def __init__(self, settings: Settings) -> None:
        super().__init__()
        self.settings = settings

    def compose(self) -> ComposeResult:
        with Container(classes="settings-container-small"):
            yield Static("Choose LLM", classes="settings-title")

            # Provider row
            with Horizontal(classes="settings-row"):
                yield Static("Provider:", classes="field-label")
                yield Select(
                    [("Gemini", "gemini"), ("OpenAI", "openai")],
                    value=self.settings.llm_provider,
                    classes="settings-select",
                )

            # Model row
            with Horizontal(classes="settings-row"):
                yield Static("Model:", classes="field-label")
                yield Input(
                    value=self._get_current_model(),
                    placeholder="Model name",
                    id="model-input",
                    classes="settings-input",
                )

            # API Key row
            with Horizontal(classes="settings-row"):
                yield Static("API Key:", classes="field-label")
                yield Input(
                    value=self._get_current_api_key(),
                    placeholder="Enter API key",
                    password=True,
                    id="api-key-input",
                    classes="settings-input",
                )

            with Horizontal(classes="button-row"):
                yield Button(
                    "Save", id="save-btn", variant="primary", classes="save-btn"
                )
                yield Button("Cancel", id="cancel-btn")

    def _get_current_model(self) -> str:
        """Get the current model name based on provider."""
        if self.settings.llm_provider == "openai":
            return self.settings.openai_model
        return self.settings.gemini_model

    def _get_current_api_key(self) -> str:
        """Get the current API key based on provider."""
        if self.settings.llm_provider == "openai":
            return self.settings.openai_api_key
        return self.settings.gemini_api_key

    @on(Select.Changed, ".settings-select")
    def on_provider_changed(self, event: Select.Changed) -> None:
        """Update model and API key fields when provider changes."""
        model_input = self.query_one("#model-input", Input)
        api_key_input = self.query_one("#api-key-input", Input)
        if event.value == "openai":
            model_input.value = self.settings.openai_model
            api_key_input.value = self.settings.openai_api_key
        else:
            model_input.value = self.settings.gemini_model
            api_key_input.value = self.settings.gemini_api_key

    @on(Button.Pressed, "#save-btn")
    def on_save(self) -> None:
        """Save settings to config file and close screen."""
        # Get values from form
        provider_select = self.query_one(".settings-select", Select)
        provider = str(provider_select.value) if provider_select.value else "gemini"
        model = self.query_one("#model-input", Input).value.strip()
        api_key = self.query_one("#api-key-input", Input).value.strip()

        # Update settings
        self.settings.llm_provider = provider
        if provider == "openai":
            self.settings.openai_model = model or self.settings.openai_model
            self.settings.openai_api_key = api_key
        else:
            self.settings.gemini_model = model or self.settings.gemini_model
            self.settings.gemini_api_key = api_key

        # Save to file
        self.settings.save()

        self.dismiss(True)

    @on(Button.Pressed, "#cancel-btn")
    def on_cancel_btn(self) -> None:
        """Close screen without saving."""
        self.dismiss(False)

    def action_cancel(self) -> None:
        """Handle escape key."""
        self.dismiss(False)


class SubtitleSettingsScreen(Screen):
    """Settings screen for configuring subtitle options."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "cancel", "Cancel"),
    ]

    CSS = SETTINGS_SCREEN_CSS

    def __init__(self, settings: Settings) -> None:
        super().__init__()
        self.settings = settings

    def compose(self) -> ComposeResult:
        with Container(classes="settings-container-small"):
            yield Static("Edit Subtitles", classes="settings-title")

            with Horizontal(classes="settings-row"):
                yield Static("Subtitle Language:", classes="field-label-wide")
                yield Input(
                    value=self.settings.subtitle_language,
                    placeholder="e.g. en, fr, zh (comma-separated priority)",
                    id="language-input",
                    classes="settings-input",
                )

            with Horizontal(classes="button-row"):
                yield Button(
                    "Save", id="save-btn", variant="primary", classes="save-btn"
                )
                yield Button("Cancel", id="cancel-btn")

    @on(Button.Pressed, "#save-btn")
    def on_save(self) -> None:
        """Save settings to config file and close screen."""
        language = self.query_one("#language-input", Input).value.strip()
        self.settings.subtitle_language = language or "en"
        self.settings.save()
        self.dismiss(True)

    @on(Button.Pressed, "#cancel-btn")
    def on_cancel_btn(self) -> None:
        """Close screen without saving."""
        self.dismiss(False)

    def action_cancel(self) -> None:
        """Handle escape key."""
        self.dismiss(False)


class PromptSettingsScreen(Screen):
    """Settings screen for configuring prompts."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "cancel", "Cancel"),
    ]

    CSS = SETTINGS_SCREEN_CSS

    def __init__(self, settings: Settings) -> None:
        super().__init__()
        self.settings = settings

    def compose(self) -> ComposeResult:
        with Container(classes="settings-container"):
            yield Static("Edit Prompts", classes="settings-title")

            # Chunk Prompt
            with Vertical(classes="prompt-section"):
                yield Static("Chunk Prompt", classes="prompt-label")
                yield TextArea(
                    self.settings.chunk_prompt,
                    id="chunk-prompt",
                    classes="prompt-textarea",
                )

            # Aggregation Prompt
            with Vertical(classes="prompt-section"):
                yield Static("Aggregation Prompt", classes="prompt-label")
                yield TextArea(
                    self.settings.aggregation_prompt,
                    id="aggregation-prompt",
                    classes="prompt-textarea",
                )

            with Horizontal(classes="button-row"):
                yield Button(
                    "Save", id="save-btn", variant="primary", classes="save-btn"
                )
                yield Button("Cancel", id="cancel-btn")

    @on(Button.Pressed, "#save-btn")
    def on_save(self) -> None:
        """Save prompt settings and close screen."""
        self.settings.chunk_prompt = self.query_one("#chunk-prompt", TextArea).text
        self.settings.aggregation_prompt = self.query_one(
            "#aggregation-prompt", TextArea
        ).text
        self.settings.save()
        self.dismiss(True)

    @on(Button.Pressed, "#cancel-btn")
    def on_cancel_btn(self) -> None:
        """Close screen without saving."""
        self.dismiss(False)

    def action_cancel(self) -> None:
        """Handle escape key."""
        self.dismiss(False)


class StageRow(Static):
    """A single pipeline stage with status icon and message."""

    PENDING = "gray"
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

        label = self.query_one(".stage-label", Label)
        label.styles.color = color

        msg_label = self.query_one(f"#msg-{self.stage_id}", Label)
        msg_label.update(message)
        msg_label.styles.color = color


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
    #title-bar {
        dock: top;
        width: 100%;
        height: 1;
        text-align: center;
        text-style: bold;
        background: $panel;
    }

    #input-row {
        height: 3;
        padding: 0 1;
        margin: 0 0 1 0;
    }

    #url-input {
        width: 1fr;
        padding: 0 1;
    }

    #start-btn {
        width: 8;
        min-width: 8;
        margin-left: 1;
    }

    #main-content {
        height: 1fr;
        padding: 0 1;
    }

    #progress-container {
        height: auto;
        padding: 0 1;
        margin-bottom: 1;
    }

    .section-title {
        text-style: bold;
        padding: 0;
        margin: 0 0 0 0;
    }

    .stage-row {
        height: 1;
        margin: 0;
        padding: 0;
    }

    .stage-icon {
        width: 2;
    }

    .stage-label {
        width: 11;
    }

    .stage-message {
        width: 1fr;
    }

    #summary-container {
        height: 1fr;
        padding: 0 1;
        margin-bottom: 1;
    }

    #summary {
        height: 1fr;
        padding: 0;
        scrollbar-size: 1 1;
    }

    #log-collapsible {
        height: auto;
        max-height: 10;
        padding: 0;
    }

    #log-collapsible > Contents {
        height: 6;
        max-height: 6;
        padding: 0 1;
    }

    #log-collapsible CollapsibleTitle {
        padding: 0;
    }

#log {
        height: 100%;
        padding: 0;
        scrollbar-size: 1 1;
    }

CommandList {
        max-height: 16;
    }
    """

    BINDINGS: ClassVar[list[BindingType]] = [
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
        yield Static("Subtext", id="title-bar")
        with Horizontal(id="input-row"):
            yield Input(placeholder="Enter a YouTube URL:", id="url-input")
            yield Button("Run", id="start-btn")
        with Vertical(id="main-content"):
            with Container(id="progress-container"):
                yield Static("Progress", classes="section-title")
                yield ProgressPanel(id="progress-panel")
            with Container(id="summary-container"):
                yield Static("Summary", classes="section-title")
                yield RichLog(id="summary", highlight=True, markup=True)
            with Collapsible(title="Logs", collapsed=True, id="log-collapsible"):
                yield RichLog(id="log", highlight=True, markup=True)
        yield Footer()

    def on_mount(self) -> None:
        self.log_message("Ready. Enter a YouTube or yt-dlp compatible URL to begin.")

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

    def action_toggle_log(self) -> None:
        """Toggle log panel visibility."""
        collapsible = self.query_one("#log-collapsible", Collapsible)
        collapsible.collapsed = not collapsible.collapsed

    def action_open_llm_settings(self) -> None:
        """Open LLM settings screen."""
        self.push_screen(LLMSettingsScreen(self.settings), self._on_settings_closed)

    def action_open_prompt_settings(self) -> None:
        """Open prompt settings screen."""
        self.push_screen(PromptSettingsScreen(self.settings), self._on_settings_closed)

    def action_open_subtitle_settings(self) -> None:
        """Open subtitle settings screen."""
        self.push_screen(
            SubtitleSettingsScreen(self.settings), self._on_settings_closed
        )

    def _on_settings_closed(self, saved: bool | None) -> None:
        """Handle settings screen close."""
        if saved:
            self.log_message("[green]Settings saved.[/green]")

    def get_system_commands(self, screen: Screen) -> Iterable[SystemCommand]:
        """Get system commands sorted alphabetically."""
        commands = list(super().get_system_commands(screen))
        commands.append(
            SystemCommand(
                "Settings: Choose LLM",
                "Configure LLM provider, model, and API key",
                self.action_open_llm_settings,
            )
        )
        commands.append(
            SystemCommand(
                "Settings: Edit Prompts",
                "Configure chunk and aggregation prompts",
                self.action_open_prompt_settings,
            )
        )
        commands.append(
            SystemCommand(
                "Settings: Edit Subtitles",
                "Configure subtitle language",
                self.action_open_subtitle_settings,
            )
        )
        commands.sort(key=lambda cmd: cmd.title.lower())
        yield from commands

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
