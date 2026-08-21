#!/usr/bin/env node

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ProcessTerminal, TuiMainScreen, type TUI } from "@earendil-works/pi-tui";

import { TranscriptAcquirer } from "./acquisition/acquire-transcript.js";
import { SubtextApp } from "./app/subtext-app.js";
import { ArtifactLibrary } from "./artifacts/artifact-library.js";
import { ManagedAsrAdapter } from "./asr/managed-asr-adapter.js";
import { ApplicationConfiguration } from "./config/application-configuration.js";
import { ApplicationSettingsStore, FileCredentialStore } from "./config/application-settings.js";
import { SystemExternalOpener } from "./platform/external-opener.js";
import { VideoProcessor } from "./processing/process-video.js";
import { RuntimeManager, type RuntimeProgress } from "./runtime/runtime-manager.js";
import { YtDlpYoutubeAdapter } from "./youtube/yt-dlp-adapter.js";

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Watchless failed to start.";
  process.stderr.write(`Watchless could not start: ${message}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const settingsStore = new ApplicationSettingsStore();
  await settingsStore.load();
  const credentials = new FileCredentialStore();
  const models = builtinModels({ credentials });
  const configuration = new ApplicationConfiguration(models, settingsStore, credentials);
  const announcedDownloads = new Set<string>();
  const runtimeManager = new RuntimeManager();
  const youtubeRuntime = await runtimeManager.prepareYoutube({
    onProgress: (progress) => reportRuntimeProgress(progress, announcedDownloads),
  });
  const terminal = new ProcessTerminal();
  const tui: TUI = new TuiMainScreen(terminal);
  const library = new ArtifactLibrary();
  const acquisition = new TranscriptAcquirer(
    new YtDlpYoutubeAdapter({
      executable: youtubeRuntime.ytDlpExecutable,
      ffmpegDirectory: youtubeRuntime.ffmpegDirectory,
    }),
    new ManagedAsrAdapter(runtimeManager),
    library,
  );
  const processing = new VideoProcessor(acquisition, library, () =>
    configuration.createSummarizer(),
  );
  const app = new SubtextApp(tui, processing, {
    configuration,
    library,
    externalOpener: new SystemExternalOpener(),
  });
  app.start();
}

function reportRuntimeProgress(progress: RuntimeProgress, announced: Set<string>): void {
  if (progress.phase !== "downloading" || announced.has(progress.packageId)) {
    return;
  }
  announced.add(progress.packageId);
  process.stderr.write(`Preparing local runtime: downloading ${progress.packageId}…\n`);
}
