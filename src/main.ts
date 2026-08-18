#!/usr/bin/env node

import { ProcessTerminal, TuiMainScreen, type TUI } from "@earendil-works/pi-tui";

import { TranscriptAcquirer } from "./acquisition/acquire-transcript.js";
import { SubtextApp } from "./app/subtext-app.js";
import { ArtifactLibrary } from "./artifacts/artifact-library.js";
import { YtDlpYoutubeAdapter } from "./youtube/yt-dlp-adapter.js";

const terminal = new ProcessTerminal();
const tui: TUI = new TuiMainScreen(terminal);
const acquisition = new TranscriptAcquirer(new YtDlpYoutubeAdapter(), new ArtifactLibrary());
const app = new SubtextApp(tui, acquisition);

app.start();
