"""Configuration management for Subtext."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Defaults
DEFAULT_LLM_PROVIDER = "gemini"
DEFAULT_GEMINI_MODEL = "gemini-1.5-flash"
DEFAULT_OPENAI_MODEL = "gpt-3.5-turbo"
DEFAULT_CHUNK_SIZE = 8000
DEFAULT_CHUNK_OVERLAP = 200
DEFAULT_OUTPUT_DIR = "./output"


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

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from environment variables."""
        load_dotenv()

        return cls(
            llm_provider=os.getenv("LLM_PROVIDER", DEFAULT_LLM_PROVIDER),
            gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
            gemini_model=os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_model=os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
            chunk_size=int(os.getenv("CHUNK_SIZE", str(DEFAULT_CHUNK_SIZE))),
            chunk_overlap=int(os.getenv("CHUNK_OVERLAP", str(DEFAULT_CHUNK_OVERLAP))),
            output_dir=Path(os.getenv("OUTPUT_DIR", DEFAULT_OUTPUT_DIR)),
        )
