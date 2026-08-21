# Use Node and Pi foundations

Watchless targets Node 24 with TypeScript, is initially distributed through npm, and uses `@earendil-works/pi-tui` for the terminal interface and `@earendil-works/pi-ai` for controlled model access, without `pi-agent-core`. This keeps the application in one runtime, reuses Pi's interactive selectors and provider support, and avoids introducing an autonomous agent where a deterministic summarization workflow is sufficient.
