const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export type YoutubeUrlResult =
  | { readonly status: "valid"; readonly videoId: string; readonly canonicalUrl: string }
  | {
      readonly status: "invalid";
      readonly reason: "not-youtube" | "not-a-video" | "invalid-video-id";
    };

export function parseYoutubeUrl(input: string): YoutubeUrlResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { status: "invalid", reason: "not-youtube" };
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return { status: "invalid", reason: "not-youtube" };
  }

  const videoId = extractVideoId(url);
  if (videoId === null) {
    return { status: "invalid", reason: "not-a-video" };
  }
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    return { status: "invalid", reason: "invalid-video-id" };
  }

  return {
    status: "valid",
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function extractVideoId(url: URL): string | null {
  if (url.hostname.toLowerCase().endsWith("youtu.be")) {
    return firstPathPart(url.pathname);
  }

  if (url.pathname === "/watch") {
    return url.searchParams.get("v");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length === 2 &&
    (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live")
  ) {
    return parts[1] ?? null;
  }

  return null;
}

function firstPathPart(pathname: string): string | null {
  return pathname.split("/").find(Boolean) ?? null;
}
