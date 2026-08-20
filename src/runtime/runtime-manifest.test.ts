import { describe, expect, it } from "vitest";

import {
  LINUX_X64_RUNTIME_MANIFEST,
  WINDOWS_X64_RUNTIME_MANIFEST,
  runtimeManifestFor,
} from "./runtime-manifest.js";

describe("runtimeManifestFor", () => {
  it("selects pinned Windows and Linux x64 runtimes", () => {
    expect(runtimeManifestFor("win32", "x64")).toBe(WINDOWS_X64_RUNTIME_MANIFEST);
    expect(runtimeManifestFor("linux", "x64")).toBe(LINUX_X64_RUNTIME_MANIFEST);
  });

  it("rejects platforms and architectures without managed assets", () => {
    expect(runtimeManifestFor("darwin", "x64")).toBeNull();
    expect(runtimeManifestFor("linux", "arm64")).toBeNull();
  });
});
