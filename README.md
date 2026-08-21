# Watchless

Watchless supports Windows 11 x64 and Linux x64. It downloads pinned platform-specific
runtime tools into `~/.watchless/runtime`; no global `yt-dlp`, FFmpeg, or whisper.cpp installation is required.

## Development commands

```bash
pnpm dev
pnpm build && node dist/main.js
```

Build standalone x64 executables with Bun:

```bash
pnpm build:linux
pnpm build:windows
```

The executables are written to `release/`.

After making changes, run:

```bash
pnpm format && pnpm lint && pnpm typecheck
```

Run `pnpm test` only when tests are present or when changing tested behavior.
