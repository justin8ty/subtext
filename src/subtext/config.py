"""Configuration management for Subtext."""

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _get_config_dir() -> Path:
    """Get platform-appropriate config directory."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
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
    lines = ["# Subtext Configuration\n"]

    if "llm" in data:
        lines.append("[llm]")
        for key, value in data["llm"].items():
            if isinstance(value, str):
                # Use single quotes for simple strings, escape if needed
                lines.append(f'{key} = "{value}"')
            else:
                lines.append(f"{key} = {value}")
        lines.append("")

    if "prompts" in data:
        lines.append("[prompts]")
        for key, value in data["prompts"].items():
            # Multi-line strings use triple quotes
            lines.append(f"{key} = '''")
            lines.append(value)
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
DEFAULT_API_DELAY = 0.5  # seconds between API calls

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
- Key points as bullet points
- Any important details or takeaways

Part summaries:
{summaries}

Final summary:"""


@dataclass
class Settings:
    """Application settings loaded from environment variables."""

    llm_provider: str = DEFAULT_LLM_PROVIDER
    gemini_api_key: str = ""
    gemini_model: str = DEFAULT_GEMINI_MODEL
    openai_api_key: str = ""
    openai_model: str = DEFAULT_OPENAI_MODEL
    chunk_size: int = DEFAULT_CHUNK_SIZE
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP
    output_dir: Path = Path(DEFAULT_OUTPUT_DIR)
    subtitle_language: str = DEFAULT_SUBTITLE_LANGUAGE
    api_delay: float = DEFAULT_API_DELAY
    chunk_prompt: str = DEFAULT_CHUNK_PROMPT
    aggregation_prompt: str = DEFAULT_AGGREGATION_PROMPT

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from TOML config file, with env vars as overrides."""
        load_dotenv()

        # Load from TOML file first
        config = _load_toml(_get_config_path())
        llm_config = config.get("llm", {})
        prompts_config = config.get("prompts", {})

        # Priority: env vars > TOML > defaults
        return cls(
            llm_provider=os.getenv(
                "LLM_PROVIDER", llm_config.get("provider", DEFAULT_LLM_PROVIDER)
            ),
            gemini_api_key=os.getenv(
                "GEMINI_API_KEY", llm_config.get("gemini_api_key", "")
            ),
            gemini_model=os.getenv(
                "GEMINI_MODEL", llm_config.get("gemini_model", DEFAULT_GEMINI_MODEL)
            ),
            openai_api_key=os.getenv(
                "OPENAI_API_KEY", llm_config.get("openai_api_key", "")
            ),
            openai_model=os.getenv(
                "OPENAI_MODEL", llm_config.get("openai_model", DEFAULT_OPENAI_MODEL)
            ),
            chunk_size=int(os.getenv("CHUNK_SIZE", str(DEFAULT_CHUNK_SIZE))),
            chunk_overlap=int(os.getenv("CHUNK_OVERLAP", str(DEFAULT_CHUNK_OVERLAP))),
            output_dir=Path(os.getenv("OUTPUT_DIR", DEFAULT_OUTPUT_DIR)),
            subtitle_language=os.getenv("SUBTITLE_LANGUAGE", DEFAULT_SUBTITLE_LANGUAGE),
            api_delay=float(os.getenv("API_DELAY", str(DEFAULT_API_DELAY))),
            chunk_prompt=os.getenv(
                "CHUNK_PROMPT", prompts_config.get("chunk_prompt", DEFAULT_CHUNK_PROMPT)
            ),
            aggregation_prompt=os.getenv(
                "AGGREGATION_PROMPT",
                prompts_config.get("aggregation_prompt", DEFAULT_AGGREGATION_PROMPT),
            ),
        )

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
            },
            "prompts": {
                "chunk_prompt": self.chunk_prompt,
                "aggregation_prompt": self.aggregation_prompt,
            },
        }

        _write_toml(config_path, data)
        return config_path
