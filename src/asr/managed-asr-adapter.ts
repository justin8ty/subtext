import type {
  RuntimeManager,
  RuntimePaths,
  RuntimePreparationOptions,
} from "../runtime/runtime-manager.js";
import type { AsrQuality } from "../runtime/runtime-manifest.js";
import {
  type AsrAdapter,
  type AsrTranscript,
  type AsrTranscriptionOptions,
} from "./asr-adapter.js";
import { WhisperCppAsrAdapter } from "./whisper-cpp-adapter.js";

type MutableRuntimePreparationOptions = {
  -readonly [Key in keyof RuntimePreparationOptions]: RuntimePreparationOptions[Key];
};

export class ManagedAsrAdapter implements AsrAdapter {
  private readonly runtimeManager: RuntimeManager;
  private readonly adapters = new Map<AsrQuality, WhisperCppAsrAdapter>();

  constructor(
    runtimeManager: RuntimeManager,
    initialQuality: AsrQuality,
    initialRuntime: RuntimePaths,
  ) {
    this.runtimeManager = runtimeManager;
    this.adapters.set(initialQuality, createAdapter(initialRuntime));
  }

  async transcribe(
    audioPath: string,
    options: AsrTranscriptionOptions = {},
  ): Promise<AsrTranscript> {
    const quality = options.quality ?? "balanced";
    let adapter = this.adapters.get(quality);
    if (adapter === undefined) {
      const preparationOptions: MutableRuntimePreparationOptions = { quality };
      if (options.signal !== undefined) {
        preparationOptions.signal = options.signal;
      }
      const runtime = await this.runtimeManager.prepare(preparationOptions);
      adapter = createAdapter(runtime);
      this.adapters.set(quality, adapter);
    }
    return adapter.transcribe(audioPath, options);
  }
}

function createAdapter(runtime: RuntimePaths): WhisperCppAsrAdapter {
  return new WhisperCppAsrAdapter({
    executable: runtime.whisperExecutable,
    modelPath: runtime.modelPath,
    modelName: runtime.modelName,
  });
}
