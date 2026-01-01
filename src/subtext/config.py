"""Configuration management for Subtext."""

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path


def _get_config_dir() -> Path:
    """Get platform-appropriate config directory."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home())))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    return base / "subtext"


def _get_config_path() -> Path:
    """Get path to config file."""
    return _get_config_dir() / "config.toml"


def _load_toml(path: Path) -> dict:
    """Load TOML file, return empty dict if not found."""
    if not path.exists():
        return {}
    try:
        import tomllib

        return tomllib.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_toml(path: Path, data: dict) -> None:
    """Write dict as TOML to file."""
    lines = ["# Subtext Configuration", ""]

    if "llm" in data:
        lines.append("[llm]")
        for key, value in data["llm"].items():
            if isinstance(value, str):
                lines.append(f'{key} = "{value}"')
            elif isinstance(value, bool):
                lines.append(f"{key} = {str(value).lower()}")
            elif isinstance(value, (int, float)):
                lines.append(f"{key} = {value}")
        lines.append("")

    if "output" in data:
        lines.append("[output]")
        for key, value in data["output"].items():
            if isinstance(value, str):
                lines.append(f'{key} = "{value}"')
        lines.append("")

    if "prompts" in data:
        lines.append("[prompts]")
        for key, value in data["prompts"].items():
            # Multi-line strings use triple quotes
            lines.append(f"{key} = '''")
            lines.append(value.strip())
            lines.append("'''")
            lines.append("")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


# Defaults
DEFAULT_LLM_PROVIDER = "gemini"
DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview"
DEFAULT_OPENAI_MODEL = "gpt-5-mini"
DEFAULT_CHUNK_SIZE = 8000
DEFAULT_CHUNK_OVERLAP = 200
DEFAULT_OUTPUT_DIR = "./output"
DEFAULT_SUBTITLE_LANGUAGE = "en"
DEFAULT_API_DELAY = 0.5

DEFAULT_CHUNK_PROMPT = """Summarize the following transcript excerpt.
Extract the key points, main ideas, and important details.
Be concise but comprehensive.

Transcript:
{text}

Summary:"""

DEFAULT_AGGREGATION_PROMPT = """You are given summaries of different parts of a video transcript.
Combine them into a single coherent summary in markdown format.
Include:
- A brief overview (2-3 sentences)
- Key points as comprehensive bullet points
- Any important details or takeaways

Part summaries:
{summaries}

Final summary:"""


@dataclass
class Settings:
    """Application settings.

    Configuration priority (highest to lowest):
    1. Environment variables (for scripting/CI overrides)
    2. TOML config file (~/.config/subtext/config.toml or %APPDATA%/subtext/config.toml)
    3. Built-in defaults
    """

    # LLM settings
    llm_provider: str = DEFAULT_LLM_PROVIDER
    gemini_api_key: str = ""
    gemini_model: str = DEFAULT_GEMINI_MODEL
    openai_api_key: str = ""
    openai_model: str = DEFAULT_OPENAI_MODEL

    # Processing settings
    chunk_size: int = DEFAULT_CHUNK_SIZE
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP
    api_delay: float = DEFAULT_API_DELAY

    # Output settings
    output_dir: Path = field(default_factory=lambda: Path(DEFAULT_OUTPUT_DIR))
    subtitle_language: str = DEFAULT_SUBTITLE_LANGUAGE

    # Prompts
    chunk_prompt: str = DEFAULT_CHUNK_PROMPT
    aggregation_prompt: str = DEFAULT_AGGREGATION_PROMPT

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from TOML config, with env vars as overrides."""
        # Load from TOML file
        config = _load_toml(_get_config_path())
        llm_config = config.get("llm", {})
        output_config = config.get("output", {})
        prompts_config = config.get("prompts", {})

        # Build settings: TOML values, then apply env var overrides
        settings = cls(
            # LLM settings
            llm_provider=llm_config.get("provider", DEFAULT_LLM_PROVIDER),
            gemini_api_key=llm_config.get("gemini_api_key", ""),
            gemini_model=llm_config.get("gemini_model", DEFAULT_GEMINI_MODEL),
            openai_api_key=llm_config.get("openai_api_key", ""),
            openai_model=llm_config.get("openai_model", DEFAULT_OPENAI_MODEL),
            # Processing settings
            chunk_size=llm_config.get("chunk_size", DEFAULT_CHUNK_SIZE),
            chunk_overlap=llm_config.get("chunk_overlap", DEFAULT_CHUNK_OVERLAP),
            api_delay=llm_config.get("api_delay", DEFAULT_API_DELAY),
            # Output settings
            output_dir=Path(output_config.get("directory", DEFAULT_OUTPUT_DIR)),
            subtitle_language=output_config.get(
                "subtitle_language", DEFAULT_SUBTITLE_LANGUAGE
            ),
            # Prompts
            chunk_prompt=prompts_config.get("chunk_prompt", DEFAULT_CHUNK_PROMPT),
            aggregation_prompt=prompts_config.get(
                "aggregation_prompt", DEFAULT_AGGREGATION_PROMPT
            ),
        )

        # Apply environment variable overrides (for scripting/CI)
        settings._apply_env_overrides()

        return settings

    def _apply_env_overrides(self) -> None:
        """Apply environment variable overrides to settings."""
        if val := os.getenv("LLM_PROVIDER"):
            self.llm_provider = val
        if val := os.getenv("GEMINI_API_KEY"):
            self.gemini_api_key = val
        if val := os.getenv("GEMINI_MODEL"):
            self.gemini_model = val
        if val := os.getenv("OPENAI_API_KEY"):
            self.openai_api_key = val
        if val := os.getenv("OPENAI_MODEL"):
            self.openai_model = val
        if val := os.getenv("SUBTITLE_LANGUAGE"):
            self.subtitle_language = val
        if val := os.getenv("OUTPUT_DIR"):
            self.output_dir = Path(val)

    def save(self) -> Path:
        """Save settings to TOML config file. Returns path to saved file."""
        config_path = _get_config_path()

        data = {
            "llm": {
                "provider": self.llm_provider,
                "gemini_api_key": self.gemini_api_key,
                "gemini_model": self.gemini_model,
                "openai_api_key": self.openai_api_key,
                "openai_model": self.openai_model,
                "chunk_size": self.chunk_size,
                "chunk_overlap": self.chunk_overlap,
                "api_delay": self.api_delay,
            },
            "output": {
                "directory": str(self.output_dir),
                "subtitle_language": self.subtitle_language,
            },
            "prompts": {
                "chunk_prompt": self.chunk_prompt,
                "aggregation_prompt": self.aggregation_prompt,
            },
        }

        _write_toml(config_path, data)
        return config_path

    @staticmethod
    def get_config_path() -> Path:
        """Get the path to the config file."""
        return _get_config_path()
