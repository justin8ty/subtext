# Subtext

## Development commands

```bash
pnpm dev
pnpm build
```

Until the in-app Options and authentication flow is available, select the Summary model through environment variables and provide that provider's standard API-key environment variable:

```bash
SUBTEXT_LLM_PROVIDER=openai SUBTEXT_LLM_MODEL=gpt-4o-mini OPENAI_API_KEY=... pnpm dev
```

After making changes, run:

```bash
pnpm format && pnpm lint && pnpm typecheck
```

Run `pnpm test` only when tests are present or when changing tested behavior.
