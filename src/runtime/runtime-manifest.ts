export type AsrQuality = "balanced" | "accurate";

export interface RuntimeDownload {
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

export interface RuntimeToolManifest {
  readonly version: string;
  readonly archive: "file" | "zip";
  readonly download: RuntimeDownload;
  readonly executableName: string;
  readonly requiredFiles: readonly string[];
}

export interface RuntimeModelManifest {
  readonly version: string;
  readonly fileName: string;
  readonly modelName: string;
  readonly download: RuntimeDownload;
}

export interface RuntimeManifest {
  readonly schemaVersion: 1;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly tools: {
    readonly ytDlp: RuntimeToolManifest;
    readonly ffmpeg: RuntimeToolManifest;
    readonly whisperCpp: RuntimeToolManifest;
  };
  readonly models: Readonly<Record<AsrQuality, RuntimeModelManifest>>;
}

const YT_DLP_VERSION = "2026.07.04";
const FFMPEG_VERSION = "N-126207-g21bbd98e7b";
const FFMPEG_RELEASE = "autobuild-2026-08-18-14-41";
const WHISPER_CPP_VERSION = "v1.9.2";
const WHISPER_MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";

export const WINDOWS_X64_RUNTIME_MANIFEST: RuntimeManifest = {
  schemaVersion: 1,
  platform: "win32",
  architecture: "x64",
  tools: {
    ytDlp: {
      version: YT_DLP_VERSION,
      archive: "file",
      download: {
        url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp.exe`,
        sha256: "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8",
        size: 18_226_085,
      },
      executableName: "yt-dlp.exe",
      requiredFiles: ["yt-dlp.exe"],
    },
    ffmpeg: {
      version: FFMPEG_VERSION,
      archive: "zip",
      download: {
        url: `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE}/ffmpeg-${FFMPEG_VERSION}-win64-gpl.zip`,
        sha256: "a8c572fb0d68df495a2e1c546d8f53bc9d7d76a87a53a1df7ab59186d1377a51",
        size: 170_644_786,
      },
      executableName: "ffmpeg.exe",
      requiredFiles: ["ffmpeg.exe", "ffprobe.exe"],
    },
    whisperCpp: {
      version: WHISPER_CPP_VERSION,
      archive: "zip",
      download: {
        url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_VERSION}/whisper-bin-x64.zip`,
        sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
        size: 8_194_445,
      },
      executableName: "whisper-cli.exe",
      requiredFiles: ["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll"],
    },
  },
  models: {
    balanced: {
      version: WHISPER_MODEL_REVISION,
      fileName: "ggml-large-v3-turbo-q5_0.bin",
      modelName: "large-v3-turbo-q5_0",
      download: {
        url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-large-v3-turbo-q5_0.bin?download=true`,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        size: 574_041_195,
      },
    },
    accurate: {
      version: WHISPER_MODEL_REVISION,
      fileName: "ggml-large-v3.bin",
      modelName: "large-v3",
      download: {
        url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/ggml-large-v3.bin?download=true`,
        sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
        size: 3_095_033_483,
      },
    },
  },
};
