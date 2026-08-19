import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

import type { AsrQuality } from "../runtime/runtime-manifest.js";

export type SummaryDetail = "concise" | "standard" | "detailed";

export interface ApplicationSettings {
  readonly schemaVersion: 1;
  readonly summaryProvider: string;
  readonly summaryModel: string;
  readonly summaryDetail: SummaryDetail;
  readonly asrQuality: AsrQuality;
}

export interface ApplicationSettingsInput {
  readonly summaryProvider: string;
  readonly summaryModel: string;
  readonly summaryDetail: SummaryDetail;
  readonly asrQuality: AsrQuality;
}

interface SettingsFile {
  readonly schemaVersion: number;
  readonly summaryProvider: string;
  readonly summaryModel: string;
  readonly summaryDetail: string;
  readonly asrQuality: string;
}

type CredentialsFile = Record<string, Credential>;
type PrivateJsonDocument = ApplicationSettings | CredentialsFile;

const SETTINGS_FILENAME = "settings.json";
const AUTH_FILENAME = "auth.json";

export class ApplicationSettingsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplicationSettingsError";
  }
}

export class ApplicationSettingsStore {
  readonly rootDirectory: string;
  private currentSettings: ApplicationSettings | null = null;

  constructor(rootDirectory = join(homedir(), ".subtext")) {
    this.rootDirectory = rootDirectory;
  }

  get current(): ApplicationSettings | null {
    return this.currentSettings;
  }

  async load(): Promise<ApplicationSettings | null> {
    try {
      const text = await readFile(join(this.rootDirectory, SETTINGS_FILENAME), "utf8");
      const settings: SettingsFile = JSON.parse(text);
      this.currentSettings = validateSettings(settings);
      return this.currentSettings;
    } catch (error) {
      if (error instanceof Error && isMissingFile(error)) {
        this.currentSettings = null;
        return null;
      }
      throw new ApplicationSettingsError("Could not read Subtext settings.", { cause: error });
    }
  }

  async save(input: ApplicationSettingsInput): Promise<ApplicationSettings> {
    const settings = validateSettings({ schemaVersion: 1, ...input });
    try {
      await writePrivateJson(join(this.rootDirectory, SETTINGS_FILENAME), settings);
      this.currentSettings = settings;
      return settings;
    } catch (error) {
      throw new ApplicationSettingsError("Could not save Subtext settings.", { cause: error });
    }
  }
}

export class FileCredentialStore implements CredentialStore {
  readonly path: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(rootDirectory = join(homedir(), ".subtext")) {
    this.path = join(rootDirectory, AUTH_FILENAME);
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    throwIfAborted(options);
    return (await this.readAll())[providerId];
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    throwIfAborted(options);
    const credentials = await this.readAll();
    return Object.entries(credentials).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.enqueue(async () => {
      throwIfAborted(options);
      const credentials = await this.readAll();
      const next = await fn(credentials[providerId]);
      throwIfAborted(options);
      if (next !== undefined) {
        credentials[providerId] = next;
        await writePrivateJson(this.path, credentials);
      }
      return next ?? credentials[providerId];
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(async () => {
      throwIfAborted(options);
      const credentials = await this.readAll();
      if (credentials[providerId] === undefined) {
        return;
      }
      delete credentials[providerId];
      await writePrivateJson(this.path, credentials);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readAll(): Promise<Record<string, Credential>> {
    try {
      const text = await readFile(this.path, "utf8");
      const value: CredentialsFile = JSON.parse(text);
      validateCredentials(value);
      return value;
    } catch (error) {
      if (error instanceof Error && isMissingFile(error)) {
        return {};
      }
      throw new ApplicationSettingsError("Could not read Subtext authentication.", {
        cause: error,
      });
    }
  }
}

function validateSettings(value: SettingsFile): ApplicationSettings {
  if (
    value.schemaVersion !== 1 ||
    value.summaryProvider.trim() === "" ||
    value.summaryModel.trim() === "" ||
    !isSummaryDetail(value.summaryDetail) ||
    !isAsrQuality(value.asrQuality)
  ) {
    throw new Error("Invalid settings file shape.");
  }
  return {
    schemaVersion: 1,
    summaryProvider: value.summaryProvider,
    summaryModel: value.summaryModel,
    summaryDetail: value.summaryDetail,
    asrQuality: value.asrQuality,
  };
}

function validateCredentials(value: CredentialsFile): void {
  if (Object.getPrototypeOf(value) !== Object.prototype || Array.isArray(value)) {
    throw new Error("Invalid credential file shape.");
  }
  for (const credential of Object.values(value)) {
    if (credential.type !== "api_key" && credential.type !== "oauth") {
      throw new Error("Invalid credential file shape.");
    }
  }
}

function isSummaryDetail(value: string): value is SummaryDetail {
  return value === "concise" || value === "standard" || value === "detailed";
}

function isAsrQuality(value: string): value is AsrQuality {
  return value === "balanced" || value === "accurate";
}

async function writePrivateJson(path: string, value: PrivateJsonDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function throwIfAborted(options?: AuthOperationOptions): void {
  if (options?.signal?.aborted === true) {
    throw options.signal.reason ?? new Error("Authentication operation was cancelled.");
  }
}

function isMissingFile(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}
