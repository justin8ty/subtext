#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ProcessTerminal, TuiMainScreen, type TUI } from "@earendil-works/pi-tui";

import { TranscriptAcquirer } from "./acquisition/acquire-transcript.js";
import { WhisperCppAsrAdapter } from "./asr/whisper-cpp-adapter.js";
import { SubtextApp } from "./app/subtext-app.js";
import { ArtifactLibrary } from "./artifacts/artifact-library.js";
import { VideoProcessor } from "./processing/process-video.js";
import {
  PiAiTranscriptSummarizer,
  UnconfiguredTranscriptSummarizer,
  type TranscriptSummarizer,
} from "./summary/transcript-summarizer.js";
import { YtDlpYoutubeAdapter } from "./youtube/yt-dlp-adapter.js";

const terminal = new ProcessTerminal();
const tui: TUI = new TuiMainScreen(terminal);
const library = new ArtifactLibrary();
const acquisition = new TranscriptAcquirer(
  new YtDlpYoutubeAdapter(),
  new WhisperCppAsrAdapter({
    executable: process.env.SUBTEXT_WHISPER_EXECUTABLE?.trim() || "whisper-cli",
    modelPath:
      process.env.SUBTEXT_WHISPER_MODEL?.trim() ||
      join(homedir(), ".subtext", "runtime", "models", "ggml-large-v3-turbo.bin"),
  }),
  library,
);
const processing = new VideoProcessor(acquisition, library, createSummarizer());
const app = new SubtextApp(tui, processing);

app.start();

function createSummarizer(): TranscriptSummarizer {
  const provider = process.env.SUBTEXT_LLM_PROVIDER?.trim();
  const modelId = process.env.SUBTEXT_LLM_MODEL?.trim();
  if (provider === undefined || provider === "" || modelId === undefined || modelId === "") {
    return new UnconfiguredTranscriptSummarizer();
  }

  const models = builtinModels();
  const model = models.getModel(provider, modelId);
  if (model === undefined) {
    return new UnconfiguredTranscriptSummarizer(
      `The configured Summary model ${provider}/${modelId} is not available.`,
    );
  }
  return new PiAiTranscriptSummarizer(models, model);
}
