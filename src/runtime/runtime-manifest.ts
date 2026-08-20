export type AsrQuality = "balanced" | "accurate";

export interface RuntimeDownload {
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

export interface RuntimeToolManifest {
  readonly version: string;
  readonly archive: "file" | "zip" | "tar.gz";
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
const WINDOWS_FFMPEG_VERSION = "N-126207-g21bbd98e7b";
const WINDOWS_FFMPEG_RELEASE = "autobuild-2026-08-18-14-41";
const LINUX_FFMPEG_VERSION = "8.1.2";
const LINUX_FFMPEG_RELEASE = "n8.1.2-1";
const WHISPER_CPP_VERSION = "v1.9.2";
const WHISPER_MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";

const MODELS: RuntimeManifest["models"] = {
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
};

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
      version: WINDOWS_FFMPEG_VERSION,
      archive: "zip",
      download: {
        url: `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/${WINDOWS_FFMPEG_RELEASE}/ffmpeg-${WINDOWS_FFMPEG_VERSION}-win64-gpl.zip`,
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
  models: MODELS,
};

export const LINUX_X64_RUNTIME_MANIFEST: RuntimeManifest = {
  schemaVersion: 1,
  platform: "linux",
  architecture: "x64",
  tools: {
    ytDlp: {
      version: YT_DLP_VERSION,
      archive: "file",
      download: {
        url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux`,
        sha256: "6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae",
        size: 39_924_536,
      },
      executableName: "yt-dlp",
      requiredFiles: ["yt-dlp"],
    },
    ffmpeg: {
      version: LINUX_FFMPEG_VERSION,
      archive: "file",
      download: {
        url: `https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/${LINUX_FFMPEG_RELEASE}/ffmpeg-linux-x64`,
        sha256: "9eac5b2b5076db5ff853a6fa0dcd6b8de7d0cac8481eadda6c47cd935825f1ee",
        size: 48_299_480,
      },
      executableName: "ffmpeg",
      requiredFiles: ["ffmpeg"],
    },
    whisperCpp: {
      version: WHISPER_CPP_VERSION,
      archive: "tar.gz",
      download: {
        url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_VERSION}/whisper-bin-ubuntu-x64.tar.gz`,
        sha256: "46811a3ecf584307480a220b9ef5ff81b7b22dc41577cbc274ce3afc61f753b1",
        size: 9_497_583,
      },
      executableName: "whisper-cli",
      requiredFiles: ["whisper-cli"],
    },
  },
  models: MODELS,
};

export function runtimeManifestFor(
  platform: NodeJS.Platform,
  architecture: string,
): RuntimeManifest | null {
  if (platform === "win32" && architecture === "x64") {
    return WINDOWS_X64_RUNTIME_MANIFEST;
  }
  if (platform === "linux" && architecture === "x64") {
    return LINUX_X64_RUNTIME_MANIFEST;
  }
  return null;
}
