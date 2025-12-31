# Subtext

A TUI-based tool to automatically extract subtitles from YouTube videos and summarize them using LLMs.

## Features

- **YouTube Subtitle Extraction**: Automatically downloads subtitles (manual or auto-generated) using yt-dlp
- **Intelligent Processing**: Cleans subtitles by removing timestamps, tags, and duplicate lines
- **Smart Chunking**: Splits long transcripts into manageable chunks with overlap
- **LLM Summarization**: Supports multiple LLM providers (Gemini, OpenAI)
- **Interactive TUI**: Beautiful terminal interface built with Textual
- **Task Cancellation**: Cancel operations at any time with Ctrl+X
- **Auto-save**: Summaries automatically saved as Markdown files

## Installation

### Prerequisites

- Python 3.10 or higher
- pip or poetry for package management

### Install from source

```bash
# Clone the repository
git clone <repository-url>
cd subtext

# Install in development mode
pip install -e .
```

### Install dependencies

```bash
pip install textual yt-dlp google-generativeai openai tiktoken python-dotenv
```

## Configuration

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and add your API keys:

```env
# Choose your LLM provider (gemini or openai)
LLM_PROVIDER=gemini

# Add your API key
GEMINI_API_KEY=your_actual_api_key_here
# OR
OPENAI_API_KEY=your_actual_api_key_here

# Optional: Customize models
GEMINI_MODEL=gemini-1.5-flash
OPENAI_MODEL=gpt-3.5-turbo

# Optional: Customize chunking
CHUNK_SIZE=8000
CHUNK_OVERLAP=200

# Optional: Customize output directory
OUTPUT_DIR=./output
```

### Getting API Keys

**Google Gemini:**
1. Visit https://makersuite.google.com/app/apikey
2. Create a new API key
3. Add it to your `.env` file

**OpenAI:**
1. Visit https://platform.openai.com/api-keys
2. Create a new API key
3. Add it to your `.env` file

## Usage

### Run the TUI application

```bash
subtext
```

Or run directly with Python:

```bash
python -m subtext.main
```

### Using the TUI

1. **Enter YouTube URL**: Paste any YouTube video URL in the input field
2. **Press Enter or click "Extract & Summarize"**: Start the process
3. **Monitor Progress**: Watch the pipeline stages update in real-time
4. **View Logs**: See detailed logs of each operation
5. **Read Summary**: Final summary appears in the bottom panel
6. **Auto-save**: Summary is automatically saved to `./output/` directory

### Keyboard Shortcuts

- **Enter**: Start processing (when URL input is focused)
- **Ctrl+X**: Cancel current operation
- **Ctrl+C**: Quit application

## How It Works

### Pipeline Stages

1. **Extraction** (⏳→🔄→✅)
   - Downloads subtitle file using yt-dlp
   - Tries manual subtitles first, falls back to auto-generated
   - Supports VTT and SRT formats

2. **Processing** (⏳→🔄→✅)
   - Removes timestamps and sequence numbers
   - Strips VTT/HTML tags
   - Normalizes whitespace
   - Merges broken sentences
   - Deduplicates consecutive identical lines

3. **Chunking** (⏳→🔄→✅)
   - Splits text into manageable chunks
   - Default: 8000 characters per chunk
   - Adds 200 character overlap between chunks
   - Respects sentence boundaries

4. **Summarization** (⏳→🔄→✅)
   - Summarizes each chunk individually
   - Aggregates chunk summaries into final summary
   - Outputs structured Markdown

## Output Format

Summaries are saved as Markdown files in the output directory with this format:

```
./output/Video_Title_20250101_123456.md
```

Each file contains:
- Video title
- Video ID
- Uploader name
- Duration
- Formatted summary in Markdown

## Customizing Prompts

The prompts used for summarization are defined in `src/subtext/summarizer.py`:

- **CHUNK_SUMMARY_PROMPT**: Used for summarizing individual chunks
- **FINAL_SUMMARY_PROMPT**: Used for creating the final aggregated summary

You can edit these prompts to customize the summarization style and output format.

## Advanced Configuration

### Change LLM Provider

Edit `.env`:
```env
LLM_PROVIDER=openai  # or gemini
```

### Adjust Chunk Size

Edit `.env`:
```env
CHUNK_SIZE=10000     # Larger chunks (better for context)
CHUNK_OVERLAP=300    # More overlap (better continuity)
```

### Change Output Directory

Edit `.env`:
```env
OUTPUT_DIR=/path/to/your/summaries
```

## Troubleshooting

### "yt-dlp not found"

Install yt-dlp:
```bash
pip install yt-dlp
```

### "No subtitles available"

The video might not have subtitles. Try:
- Videos with manually added subtitles
- Videos with auto-generated captions
- English-language videos (default subtitle language)

### API Key Errors

Make sure:
- Your `.env` file exists in the project root
- API key is correctly copied (no extra spaces)
- API key has sufficient quota/credits

### Import Errors

Install all dependencies:
```bash
pip install textual yt-dlp google-generativeai openai python-dotenv
```

## Development

### Project Structure

```
subtext/
├── src/subtext/
│   ├── __init__.py      # Package initialization
│   ├── config.py        # Configuration management
│   ├── extractor.py     # Subtitle extraction with yt-dlp
│   ├── processor.py     # Subtitle text processing
│   ├── chunker.py       # Text chunking logic
│   ├── summarizer.py    # LLM integration
│   └── main.py          # TUI application
├── pyproject.toml       # Project metadata and dependencies
├── .env.example         # Example environment variables
└── README.md            # This file
```

### Running Tests

```bash
pytest
```

### Code Formatting

```bash
black src/
ruff check src/
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
