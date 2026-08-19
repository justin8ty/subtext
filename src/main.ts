#!/usr/bin/env node

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ProcessTerminal, TuiMainScreen, type TUI } from "@earendil-works/pi-tui";

import { TranscriptAcquirer } from "./acquisition/acquire-transcript.js";
import { SubtextApp } from "./app/subtext-app.js";
import { ArtifactLibrary } from "./artifacts/artifact-library.js";
import { ManagedAsrAdapter } from "./asr/managed-asr-adapter.js";
import { ApplicationConfiguration } from "./config/application-configuration.js";
import { ApplicationSettingsStore, FileCredentialStore } from "./config/application-settings.js";
import { VideoProcessor } from "./processing/process-video.js";
import { RuntimeManager, type RuntimeProgress } from "./runtime/runtime-manager.js";
import { YtDlpYoutubeAdapter } from "./youtube/yt-dlp-adapter.js";

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Subtext failed to start.";
  process.stderr.write(`Subtext could not start: ${message}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const settingsStore = new ApplicationSettingsStore();
  const settings = await settingsStore.load();
  const credentials = new FileCredentialStore();
  const models = builtinModels({ credentials });
  const configuration = new ApplicationConfiguration(models, settingsStore, credentials);
  const asrQuality = settings?.asrQuality ?? "balanced";
  const announcedDownloads = new Set<string>();
  const runtimeManager = new RuntimeManager();
  const runtime = await runtimeManager.prepare({
    quality: asrQuality,
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
    new ManagedAsrAdapter(runtimeManager, asrQuality, runtime),
    library,
  );
  const processing = new VideoProcessor(acquisition, library, () =>
    configuration.createSummarizer(),
  );
  const app = new SubtextApp(tui, processing, configuration);
  app.start();
}

function reportRuntimeProgress(progress: RuntimeProgress, announced: Set<string>): void {
  if (progress.phase !== "downloading" || announced.has(progress.packageId)) {
    return;
  }
  announced.add(progress.packageId);
  process.stderr.write(`Preparing local runtime: downloading ${progress.packageId}…\n`);
}
