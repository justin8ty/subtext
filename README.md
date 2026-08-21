# Watchless

Watchless supports Windows 11 x64 and Linux x64. It downloads pinned platform-specific
runtime tools into `~/.subtext/runtime`; no global `yt-dlp`, FFmpeg, or whisper.cpp
installation is required.

## Development commands

```bash
pnpm dev
pnpm build
```

Build the standalone Windows x64 executable with Bun:

```bash
pnpm build:windows
```

The executable is written to `release/watchless.exe`.

After making changes, run:

```bash
pnpm format && pnpm lint && pnpm typecheck
```

Run `pnpm test` only when tests are present or when changing tested behavior.
