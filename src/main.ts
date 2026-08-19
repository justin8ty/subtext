#!/usr/bin/env node

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ProcessTerminal, TuiMainScreen, type TUI } from "@earendil-works/pi-tui";

import { TranscriptAcquirer } from "./acquisition/acquire-transcript.js";
import { WhisperCppAsrAdapter } from "./asr/whisper-cpp-adapter.js";
import { SubtextApp } from "./app/subtext-app.js";
import { ArtifactLibrary } from "./artifacts/artifact-library.js";
import { VideoProcessor } from "./processing/process-video.js";
import { RuntimeManager, type RuntimeProgress } from "./runtime/runtime-manager.js";
import {
  PiAiTranscriptSummarizer,
  UnconfiguredTranscriptSummarizer,
  type TranscriptSummarizer,
} from "./summary/transcript-summarizer.js";
import { YtDlpYoutubeAdapter } from "./youtube/yt-dlp-adapter.js";

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Subtext failed to start.";
  process.stderr.write(`Subtext could not prepare its local runtime: ${message}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const announcedDownloads = new Set<string>();
  const runtime = await new RuntimeManager().prepare({
    quality: "balanced",
    onProgress: (progress) => reportRuntimeProgress(progress, announcedDownloads),
  });
  const terminal = new ProcessTerminal();
  const tui: TUI = new TuiMainScreen(terminal);
  const library = new ArtifactLibrary();
  const acquisition = new TranscriptAcquirer(
    new YtDlpYoutubeAdapter({
      executable: runtime.ytDlpExecutable,
      ffmpegDirectory: runtime.ffmpegDirectory,
    }),
    new WhisperCppAsrAdapter({
      executable: runtime.whisperExecutable,
      modelPath: runtime.modelPath,
      modelName: runtime.modelName,
    }),
    library,
  );
  const processing = new VideoProcessor(acquisition, library, createSummarizer());
  const app = new SubtextApp(tui, processing);
  app.start();
}

function reportRuntimeProgress(progress: RuntimeProgress, announced: Set<string>): void {
  if (progress.phase !== "downloading" || announced.has(progress.packageId)) {
    return;
  }
  announced.add(progress.packageId);
  process.stderr.write(`Preparing local runtime: downloading ${progress.packageId}…\n`);
}

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
