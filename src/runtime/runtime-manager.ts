import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import extractZip from "extract-zip";
import { x as extractTar } from "tar";

import {
  runtimeManifestFor,
  type AsrQuality,
  type RuntimeDownload,
  type RuntimeManifest,
  type RuntimeModelManifest,
  type RuntimeToolManifest,
} from "./runtime-manifest.js";

const RECEIPT_FILENAME = ".subtext-runtime.json";
const RECEIPT_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

type RuntimePackageId = "yt-dlp" | "ffmpeg" | "whisper.cpp" | `model-${AsrQuality}`;

export type RuntimePreparationMode = "ensure" | "update" | "repair";

export type RuntimeProgress =
  | { readonly phase: "checking"; readonly packageId: RuntimePackageId }
  | {
      readonly phase: "downloading";
      readonly packageId: RuntimePackageId;
      readonly downloadedBytes: number;
      readonly totalBytes: number;
    }
  | { readonly phase: "installing"; readonly packageId: RuntimePackageId }
  | { readonly phase: "ready"; readonly packageId: RuntimePackageId };

export interface RuntimePreparationOptions {
  readonly mode?: RuntimePreparationMode;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RuntimeProgress) => void;
}

export interface AsrRuntimePreparationOptions extends RuntimePreparationOptions {
  readonly quality?: AsrQuality;
}

export interface YoutubeRuntimePaths {
  readonly rootDirectory: string;
  readonly ytDlpExecutable: string;
  readonly ffmpegExecutable: string;
  readonly ffmpegDirectory: string;
  readonly versions: {
    readonly ytDlp: string;
    readonly ffmpeg: string;
  };
}

export interface AsrRuntimePaths {
  readonly rootDirectory: string;
  readonly whisperExecutable: string;
  readonly modelPath: string;
  readonly modelName: string;
  readonly versions: {
    readonly whisperCpp: string;
    readonly model: string;
  };
}

export type RuntimeManagerErrorKind =
  | "unsupported-platform"
  | "cancelled"
  | "download"
  | "verification"
  | "install";

export class RuntimeManagerError extends Error {
  readonly kind: RuntimeManagerErrorKind;

  constructor(kind: RuntimeManagerErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeManagerError";
    this.kind = kind;
  }
}

export interface RuntimeHttpClient {
  get(url: string, signal?: AbortSignal): Promise<Response>;
}

export interface RuntimeManagerOptions {
  readonly rootDirectory?: string;
  readonly manifest?: RuntimeManifest;
  readonly httpClient?: RuntimeHttpClient;
}

interface RuntimePackageSpec {
  readonly id: RuntimePackageId;
  readonly category: "tools" | "models";
  readonly directoryName: string;
  readonly version: string;
  readonly archive: RuntimeToolManifest["archive"];
  readonly download: RuntimeDownload;
  readonly directFileName?: string;
  readonly primaryFile: string;
  readonly executable: boolean;
  readonly requiredFiles: readonly string[];
}

interface RuntimeReceiptFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

interface RuntimeReceipt {
  readonly schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  readonly identity: string;
  readonly primaryPath: string;
  readonly requiredPaths: Readonly<Record<string, string>>;
  readonly files: readonly RuntimeReceiptFile[];
}

interface InstalledPackage {
  readonly directory: string;
  readonly primaryPath: string;
}

export class RuntimeManager {
  readonly rootDirectory: string;
  readonly manifest: RuntimeManifest;
  private readonly httpClient: RuntimeHttpClient;

  constructor(options: RuntimeManagerOptions = {}) {
    this.rootDirectory = options.rootDirectory ?? join(homedir(), ".subtext", "runtime");
    const manifest = options.manifest ?? runtimeManifestFor(process.platform, process.arch);
    if (manifest === null) {
      throw new RuntimeManagerError(
        "unsupported-platform",
        `Subtext has no managed runtime for ${process.platform}/${process.arch}.`,
      );
    }
    this.manifest = manifest;
    this.httpClient = options.httpClient ?? new FetchRuntimeHttpClient();
  }

  async prepareYoutube(options: RuntimePreparationOptions = {}): Promise<YoutubeRuntimePaths> {
    const installed = await this.preparePackages(youtubePackageSpecs(this.manifest), options);
    const ytDlp = requireInstalled(installed, "yt-dlp");
    const ffmpeg = requireInstalled(installed, "ffmpeg");
    return {
      rootDirectory: this.rootDirectory,
      ytDlpExecutable: ytDlp.primaryPath,
      ffmpegExecutable: ffmpeg.primaryPath,
      ffmpegDirectory: dirname(ffmpeg.primaryPath),
      versions: {
        ytDlp: this.manifest.tools.ytDlp.version,
        ffmpeg: this.manifest.tools.ffmpeg.version,
      },
    };
  }

  async prepareAsr(options: AsrRuntimePreparationOptions = {}): Promise<AsrRuntimePaths> {
    const quality = options.quality ?? "balanced";
    const installed = await this.preparePackages(asrPackageSpecs(this.manifest, quality), options);
    const whisper = requireInstalled(installed, "whisper.cpp");
    const model = requireInstalled(installed, `model-${quality}`);
    return {
      rootDirectory: this.rootDirectory,
      whisperExecutable: whisper.primaryPath,
      modelPath: model.primaryPath,
      modelName: this.manifest.models[quality].modelName,
      versions: {
        whisperCpp: this.manifest.tools.whisperCpp.version,
        model: this.manifest.models[quality].version,
      },
    };
  }

  private async preparePackages(
    specs: readonly RuntimePackageSpec[],
    options: RuntimePreparationOptions,
  ): Promise<ReadonlyMap<RuntimePackageId, InstalledPackage>> {
    this.validateTarget();
    validateManifest(this.manifest);
    throwIfAborted(options.signal);

    const mode = options.mode ?? "ensure";
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });

    const installed = new Map<RuntimePackageId, InstalledPackage>();
    for (const spec of specs) {
      emitProgress(options.onProgress, { phase: "checking", packageId: spec.id });
      const existing = await verifyInstalledPackage(
        this.packageDirectory(spec),
        spec,
        mode === "repair",
      );
      const runtimePackage =
        existing ?? (await this.installPackage(spec, options.signal, options.onProgress));
      installed.set(spec.id, runtimePackage);
      emitProgress(options.onProgress, { phase: "ready", packageId: spec.id });
    }

    if (mode === "update") {
      await this.removeObsoleteVersions(specs);
    }
    return installed;
  }

  private validateTarget(): void {
    if (
      process.platform !== this.manifest.platform ||
      process.arch !== this.manifest.architecture
    ) {
      throw new RuntimeManagerError(
        "unsupported-platform",
        `Subtext runtime ${this.manifest.platform}/${this.manifest.architecture} cannot run on ${process.platform}/${process.arch}.`,
      );
    }
  }

  private async installPackage(
    spec: RuntimePackageSpec,
    signal?: AbortSignal,
    onProgress?: (progress: RuntimeProgress) => void,
  ): Promise<InstalledPackage> {
    throwIfAborted(signal);
    const stagingDirectory = join(this.rootDirectory, `.staging-${spec.id}-${randomUUID()}`);
    const downloadPath = join(stagingDirectory, "download");
    const contentDirectory = join(stagingDirectory, "content");
    const destination = this.packageDirectory(spec);
    const backup = `${destination}.replaced-${randomUUID()}`;
    let movedExisting = false;

    await mkdir(contentDirectory, { recursive: true, mode: 0o700 });
    try {
      await downloadVerified(spec, downloadPath, this.httpClient, signal, onProgress);
      throwIfAborted(signal);
      emitProgress(onProgress, { phase: "installing", packageId: spec.id });
      await extractRuntimePackage(spec, downloadPath, contentDirectory);
      throwIfAborted(signal);

      const receipt = await createReceipt(contentDirectory, spec);
      if (spec.executable && process.platform !== "win32") {
        await chmod(safeReceiptPath(contentDirectory, receipt.primaryPath), 0o700);
      }
      await writeFile(
        join(contentDirectory, RECEIPT_FILENAME),
        `${JSON.stringify(receipt, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const concurrentlyInstalled = await verifyInstalledPackage(destination, spec, true);
      if (concurrentlyInstalled !== null) {
        return concurrentlyInstalled;
      }
      try {
        await rename(destination, backup);
        movedExisting = true;
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
      await rename(contentDirectory, destination);
      if (movedExisting) {
        await rm(backup, { recursive: true, force: true });
      }

      const installed = await verifyInstalledPackage(destination, spec, false);
      if (installed === null) {
        throw new RuntimeManagerError(
          "install",
          `Runtime package ${spec.id} was incomplete after installation.`,
        );
      }
      return installed;
    } catch (error) {
      if (movedExisting) {
        await rm(destination, { recursive: true, force: true }).catch(() => undefined);
        await rename(backup, destination).catch(() => undefined);
      }
      if (error instanceof RuntimeManagerError) {
        throw error;
      }
      throw new RuntimeManagerError("install", `Could not install runtime package ${spec.id}.`, {
        cause: error,
      });
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private packageDirectory(spec: RuntimePackageSpec): string {
    return join(this.rootDirectory, spec.category, spec.directoryName, spec.version);
  }

  private async removeObsoleteVersions(specs: readonly RuntimePackageSpec[]): Promise<void> {
    for (const spec of specs) {
      const packageRoot = join(this.rootDirectory, spec.category, spec.directoryName);
      let entries;
      try {
        entries = await readdir(packageRoot, { withFileTypes: true });
      } catch (error) {
        if (isMissingPathError(error)) {
          continue;
        }
        throw new RuntimeManagerError(
          "install",
          `Could not inspect old versions of runtime package ${spec.id}.`,
          { cause: error },
        );
      }
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name !== spec.version)
          .map((entry) => rm(join(packageRoot, entry.name), { recursive: true, force: true })),
      );
    }
  }
}

function youtubePackageSpecs(manifest: RuntimeManifest): readonly RuntimePackageSpec[] {
  return [
    toolSpec("yt-dlp", "yt-dlp", manifest.tools.ytDlp),
    toolSpec("ffmpeg", "ffmpeg", manifest.tools.ffmpeg),
  ];
}

function asrPackageSpecs(
  manifest: RuntimeManifest,
  quality: AsrQuality,
): readonly RuntimePackageSpec[] {
  return [
    toolSpec("whisper.cpp", "whisper.cpp", manifest.tools.whisperCpp),
    modelSpec(quality, manifest.models[quality]),
  ];
}

function toolSpec(
  id: Exclude<RuntimePackageId, `model-${AsrQuality}`>,
  directoryName: string,
  tool: RuntimeToolManifest,
): RuntimePackageSpec {
  const base = {
    id,
    category: "tools" as const,
    directoryName,
    version: tool.version,
    archive: tool.archive,
    download: tool.download,
    primaryFile: tool.executableName,
    requiredFiles: tool.requiredFiles,
    executable: true,
  };
  return tool.archive === "file" ? { ...base, directFileName: tool.executableName } : base;
}

function modelSpec(quality: AsrQuality, model: RuntimeModelManifest): RuntimePackageSpec {
  return {
    id: `model-${quality}`,
    category: "models",
    directoryName: quality,
    version: model.version,
    archive: "file",
    download: model.download,
    directFileName: model.fileName,
    primaryFile: model.fileName,
    requiredFiles: [model.fileName],
    executable: false,
  };
}

async function extractRuntimePackage(
  spec: RuntimePackageSpec,
  downloadPath: string,
  contentDirectory: string,
): Promise<void> {
  if (spec.archive === "zip") {
    await extractZip(downloadPath, { dir: resolve(contentDirectory) });
    await materializeArchiveSymlinks(contentDirectory);
    return;
  }
  if (spec.archive === "tar.gz") {
    await extractTarGzip(downloadPath, contentDirectory);
    return;
  }

  const directFileName = spec.directFileName;
  if (directFileName === undefined) {
    throw new RuntimeManagerError("install", `Runtime package ${spec.id} has no file name.`);
  }
  await rename(downloadPath, join(contentDirectory, directFileName));
}

interface ArchiveLink {
  readonly path: string;
  readonly target: string;
  readonly type: "hard" | "symbolic";
}

async function extractTarGzip(downloadPath: string, contentDirectory: string): Promise<void> {
  const links: ArchiveLink[] = [];
  await extractTar({
    cwd: resolve(contentDirectory),
    file: downloadPath,
    filter: (path, entry) => {
      if (!("type" in entry) || (entry.type !== "SymbolicLink" && entry.type !== "Link")) {
        return true;
      }
      if (!("linkpath" in entry) || entry.linkpath === "") {
        throw new RuntimeManagerError("install", "A runtime archive contains an invalid link.");
      }
      links.push({
        path,
        target: entry.linkpath,
        type: entry.type === "Link" ? "hard" : "symbolic",
      });
      return false;
    },
    preserveOwner: false,
    strict: true,
  });
  await materializeDeclaredArchiveLinks(contentDirectory, links);
}

async function materializeDeclaredArchiveLinks(
  rootDirectory: string,
  links: readonly ArchiveLink[],
): Promise<void> {
  const targets = new Map<string, string>();
  for (const link of links) {
    const path = safeArchivePath(link.path);
    const target = safeArchivePath(
      link.type === "hard" ? link.target : posix.join(posix.dirname(path), link.target),
    );
    if (targets.has(path)) {
      throw new RuntimeManagerError("install", "A runtime archive contains duplicate links.");
    }
    targets.set(path, target);
  }

  const resolveTarget = (initialTarget: string): string => {
    let target = initialTarget;
    const visited = new Set<string>();
    while (targets.has(target)) {
      if (visited.has(target)) {
        throw new RuntimeManagerError("install", "A runtime archive contains a link cycle.");
      }
      visited.add(target);
      target = targets.get(target)!;
    }
    return target;
  };

  for (const [path, target] of targets) {
    const source = safeReceiptPath(rootDirectory, resolveTarget(target));
    const metadata = await stat(source);
    if (!metadata.isFile()) {
      throw new RuntimeManagerError(
        "install",
        "Runtime archive links must resolve to regular files.",
      );
    }
    const destination = safeReceiptPath(rootDirectory, path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination);
    await chmod(destination, metadata.mode & 0o777);
  }
}

function safeArchivePath(path: string): string {
  const normalized = posix.normalize(path);
  if (
    normalized === "" ||
    normalized === "." ||
    posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new RuntimeManagerError("install", "A runtime archive contains an unsafe path.");
  }
  return normalized;
}

async function materializeArchiveSymlinks(rootDirectory: string): Promise<void> {
  const root = resolve(rootDirectory);
  const links: Array<{ path: string; target: string; mode: number }> = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isSymbolicLink()) {
        continue;
      }

      const target = await realpath(path);
      const relativeTarget = relative(root, target);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${sep}`) ||
        isAbsolute(relativeTarget)
      ) {
        throw new RuntimeManagerError(
          "install",
          "A runtime archive contains a link outside its package.",
        );
      }
      const metadata = await stat(target);
      if (!metadata.isFile()) {
        throw new RuntimeManagerError(
          "install",
          "Runtime archive links must resolve to regular files.",
        );
      }
      links.push({ path, target, mode: metadata.mode });
    }
  }

  await visit(root);
  for (const link of links) {
    await rm(link.path, { force: true });
    await copyFile(link.target, link.path);
    await chmod(link.path, link.mode & 0o777);
  }
}

class FetchRuntimeHttpClient implements RuntimeHttpClient {
  get(url: string, signal?: AbortSignal): Promise<Response> {
    const init: RequestInit = {
      headers: { "User-Agent": "Subtext runtime manager" },
      redirect: "follow",
    };
    if (signal !== undefined) {
      init.signal = signal;
    }
    return fetch(url, init);
  }
}

async function downloadVerified(
  spec: RuntimePackageSpec,
  destination: string,
  httpClient: RuntimeHttpClient,
  signal?: AbortSignal,
  onProgress?: (progress: RuntimeProgress) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await httpClient.get(spec.download.url, signal);
  } catch (error) {
    if (signal?.aborted === true) {
      throw new RuntimeManagerError("cancelled", "Runtime preparation was cancelled.", {
        cause: error,
      });
    }
    throw new RuntimeManagerError("download", `Could not download runtime package ${spec.id}.`, {
      cause: error,
    });
  }

  if (!response.ok || response.body === null) {
    throw new RuntimeManagerError(
      "download",
      `Runtime package ${spec.id} download failed with HTTP ${response.status}.`,
    );
  }

  const file = await open(destination, "wx", 0o600);
  const hash = createHash("sha256");
  let downloadedBytes = 0;
  let lastProgressAt = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      throwIfAborted(signal);
      downloadedBytes += chunk.value.byteLength;
      if (downloadedBytes > spec.download.size) {
        throw new RuntimeManagerError(
          "verification",
          `Runtime package ${spec.id} exceeded its pinned size.`,
        );
      }
      hash.update(chunk.value);
      await file.write(chunk.value);
      const now = Date.now();
      if (now - lastProgressAt >= 250 || downloadedBytes === spec.download.size) {
        lastProgressAt = now;
        emitProgress(onProgress, {
          phase: "downloading",
          packageId: spec.id,
          downloadedBytes,
          totalBytes: spec.download.size,
        });
      }
    }
  } catch (error) {
    if (signal?.aborted === true && !(error instanceof RuntimeManagerError)) {
      throw new RuntimeManagerError("cancelled", "Runtime preparation was cancelled.", {
        cause: error,
      });
    }
    throw error;
  } finally {
    await file.close();
  }

  const digest = hash.digest("hex");
  if (downloadedBytes !== spec.download.size || digest !== spec.download.sha256) {
    throw new RuntimeManagerError(
      "verification",
      `Runtime package ${spec.id} did not match its pinned size and SHA-256 digest.`,
    );
  }
}

async function createReceipt(
  contentDirectory: string,
  spec: RuntimePackageSpec,
): Promise<RuntimeReceipt> {
  const files = await inventoryFiles(contentDirectory, true);
  const requiredPaths: Record<string, string> = {};
  for (const requiredFile of spec.requiredFiles) {
    const matches = files.filter(
      (file) => basename(file.path).toLowerCase() === requiredFile.toLowerCase(),
    );
    if (matches.length !== 1) {
      throw new RuntimeManagerError(
        "install",
        `Runtime package ${spec.id} must contain exactly one ${requiredFile}.`,
      );
    }
    requiredPaths[requiredFile] = matches[0]!.path;
  }

  const primaryPath = requiredPaths[spec.primaryFile];
  if (primaryPath === undefined) {
    throw new RuntimeManagerError(
      "install",
      `Runtime package ${spec.id} did not contain ${spec.primaryFile}.`,
    );
  }
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    identity: packageIdentity(spec),
    primaryPath,
    requiredPaths,
    files,
  };
}

async function verifyInstalledPackage(
  directory: string,
  spec: RuntimePackageSpec,
  verifyDigests: boolean,
): Promise<InstalledPackage | null> {
  try {
    // SAFETY: the receipt is validated against its schema and pinned package identity below.
    const receipt = JSON.parse(
      await readFile(join(directory, RECEIPT_FILENAME), "utf8"),
    ) as RuntimeReceipt;
    if (!isValidReceipt(receipt, spec)) {
      return null;
    }

    for (const file of receipt.files) {
      const path = safeReceiptPath(directory, file.path);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size !== file.size) {
        return null;
      }
      if (verifyDigests && (await sha256File(path)) !== file.sha256) {
        return null;
      }
    }
    const primaryPath = safeReceiptPath(directory, receipt.primaryPath);
    if (
      spec.executable &&
      process.platform !== "win32" &&
      ((await stat(primaryPath)).mode & 0o111) === 0
    ) {
      return null;
    }
    for (const requiredFile of spec.requiredFiles) {
      const requiredPath = receipt.requiredPaths[requiredFile];
      if (requiredPath === undefined) {
        return null;
      }
      await stat(safeReceiptPath(directory, requiredPath));
    }
    return { directory, primaryPath };
  } catch {
    return null;
  }
}

async function inventoryFiles(
  rootDirectory: string,
  includeDigests: boolean,
): Promise<RuntimeReceiptFile[]> {
  const files: RuntimeReceiptFile[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const metadata = await stat(path);
        files.push({
          path: portableRelativePath(rootDirectory, path),
          size: metadata.size,
          sha256: includeDigests ? await sha256File(path) : "",
        });
      } else {
        throw new RuntimeManagerError(
          "install",
          "Runtime archives may contain only regular files and directories.",
        );
      }
    }
  }
  await visit(rootDirectory);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function sha256File(path: string): Promise<string> {
  const file = await open(path, "r");
  const hash = createHash("sha256");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}

function isValidReceipt(receipt: RuntimeReceipt, spec: RuntimePackageSpec): boolean {
  return (
    receipt.schemaVersion === RECEIPT_SCHEMA_VERSION &&
    receipt.identity === packageIdentity(spec) &&
    receipt.primaryPath === receipt.requiredPaths[spec.primaryFile] &&
    Array.isArray(receipt.files) &&
    receipt.files.length > 0 &&
    receipt.files.every(
      (file) =>
        file.path.length > 0 &&
        Number.isSafeInteger(file.size) &&
        file.size >= 0 &&
        SHA256_PATTERN.test(file.sha256),
    ) &&
    spec.requiredFiles.every((requiredFile) => {
      const requiredPath = receipt.requiredPaths[requiredFile];
      return (
        requiredPath !== undefined &&
        basename(requiredPath).toLowerCase() === requiredFile.toLowerCase() &&
        receipt.files.some((file) => file.path === requiredPath)
      );
    })
  );
}

function safeReceiptPath(rootDirectory: string, portablePath: string): string {
  if (
    portablePath === "" ||
    isAbsolute(portablePath) ||
    portablePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new RuntimeManagerError("verification", "A runtime receipt contains an unsafe path.");
  }
  const path = resolve(rootDirectory, ...portablePath.split("/"));
  const relativePath = relative(resolve(rootDirectory), path);
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    throw new RuntimeManagerError("verification", "A runtime receipt escapes its package.");
  }
  return path;
}

function portableRelativePath(rootDirectory: string, path: string): string {
  return relative(rootDirectory, path).split(sep).join("/");
}

function packageIdentity(spec: RuntimePackageSpec): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: spec.id,
        version: spec.version,
        archive: spec.archive,
        download: spec.download,
        directFileName: spec.directFileName,
        primaryFile: spec.primaryFile,
        requiredFiles: spec.requiredFiles,
        executable: spec.executable,
      }),
    )
    .digest("hex");
}

function validateManifest(manifest: RuntimeManifest): void {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform.trim() === "" ||
    manifest.architecture.trim() === ""
  ) {
    throw new RuntimeManagerError("verification", "The embedded runtime manifest is invalid.");
  }
  const tools = [manifest.tools.ytDlp, manifest.tools.ffmpeg, manifest.tools.whisperCpp];
  const models = [manifest.models.balanced, manifest.models.accurate];
  if (
    tools.some(
      (tool) =>
        !safePathPart(tool.version) ||
        (tool.archive !== "file" && tool.archive !== "zip" && tool.archive !== "tar.gz") ||
        !safeFileName(tool.executableName) ||
        tool.requiredFiles.length === 0 ||
        tool.requiredFiles.some((file) => !safeFileName(file)) ||
        !validDownload(tool.download),
    ) ||
    models.some(
      (model) =>
        !safePathPart(model.version) ||
        !safeFileName(model.fileName) ||
        model.modelName.trim() === "" ||
        !validDownload(model.download),
    )
  ) {
    throw new RuntimeManagerError("verification", "The embedded runtime manifest is invalid.");
  }
}

function validDownload(download: RuntimeDownload): boolean {
  try {
    const url = new URL(download.url);
    return (
      url.protocol === "https:" &&
      SHA256_PATTERN.test(download.sha256) &&
      Number.isSafeInteger(download.size) &&
      download.size > 0
    );
  } catch {
    return false;
  }
}

function safePathPart(value: string): boolean {
  return (
    value !== "" && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\")
  );
}

function safeFileName(value: string): boolean {
  return safePathPart(value) && basename(value) === value;
}

function requireInstalled(
  installed: ReadonlyMap<RuntimePackageId, InstalledPackage>,
  id: RuntimePackageId,
): InstalledPackage {
  const runtimePackage = installed.get(id);
  if (runtimePackage === undefined) {
    throw new RuntimeManagerError("install", `Runtime package ${id} was not prepared.`);
  }
  return runtimePackage;
}

function emitProgress(
  listener: ((progress: RuntimeProgress) => void) | undefined,
  progress: RuntimeProgress,
): void {
  try {
    listener?.(progress);
  } catch {
    // Progress reporting must not break runtime installation.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new RuntimeManagerError("cancelled", "Runtime preparation was cancelled.");
  }
}

function isMissingPathError(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}
