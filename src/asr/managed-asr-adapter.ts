import {
  RuntimeManagerError,
  type AsrRuntimePaths,
  type AsrRuntimePreparationOptions,
  type RuntimeManager,
} from "../runtime/runtime-manager.js";
import type { AsrQuality } from "../runtime/runtime-manifest.js";
import {
  AsrAdapterError,
  type AsrAdapter,
  type AsrTranscript,
  type AsrTranscriptionOptions,
} from "./asr-adapter.js";
import { WhisperCppAsrAdapter } from "./whisper-cpp-adapter.js";

type MutableAsrRuntimePreparationOptions = {
  -readonly [Key in keyof AsrRuntimePreparationOptions]: AsrRuntimePreparationOptions[Key];
};

export class ManagedAsrAdapter implements AsrAdapter {
  private readonly runtimeManager: RuntimeManager;
  private readonly adapters = new Map<AsrQuality, WhisperCppAsrAdapter>();

  constructor(runtimeManager: RuntimeManager) {
    this.runtimeManager = runtimeManager;
  }

  async transcribe(
    audioPath: string,
    options: AsrTranscriptionOptions = {},
  ): Promise<AsrTranscript> {
    const quality = options.quality ?? "balanced";
    let adapter = this.adapters.get(quality);
    if (adapter === undefined) {
      const preparationOptions: MutableAsrRuntimePreparationOptions = { quality };
      if (options.signal !== undefined) {
        preparationOptions.signal = options.signal;
      }
      let runtime: AsrRuntimePaths;
      try {
        runtime = await this.runtimeManager.prepareAsr(preparationOptions);
      } catch (error) {
        if (error instanceof RuntimeManagerError) {
          throw runtimePreparationError(error);
        }
        throw error;
      }
      adapter = createAdapter(runtime);
      this.adapters.set(quality, adapter);
    }
    return adapter.transcribe(audioPath, options);
  }
}

function runtimePreparationError(error: RuntimeManagerError): AsrAdapterError {
  if (error.kind === "cancelled") {
    return new AsrAdapterError("cancelled", error.message, { cause: error });
  }
  if (error.kind === "unsupported-platform") {
    return new AsrAdapterError("unavailable", error.message, { cause: error });
  }
  return new AsrAdapterError("failed", error.message, { cause: error });
}

function createAdapter(runtime: AsrRuntimePaths): WhisperCppAsrAdapter {
  return new WhisperCppAsrAdapter({
    executable: runtime.whisperExecutable,
    modelPath: runtime.modelPath,
    modelName: runtime.modelName,
  });
}
