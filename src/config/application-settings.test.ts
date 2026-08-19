import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { afterEach, describe, expect, it } from "vitest";

import { ApplicationConfiguration } from "./application-configuration.js";
import { ApplicationSettingsStore, FileCredentialStore } from "./application-settings.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Subtext configuration", () => {
  it("persists intent settings and pi-compatible provider authentication", async () => {
    const rootDirectory = await temporaryDirectory();
    const settingsStore = new ApplicationSettingsStore(rootDirectory);
    const credentials = new FileCredentialStore(rootDirectory);
    const models = builtinModels({ credentials });
    const configuration = new ApplicationConfiguration(models, settingsStore, credentials);

    await expect(settingsStore.load()).resolves.toBeNull();
    await configuration.save({
      summaryProvider: "deepseek",
      summaryModel: "deepseek-v4-flash",
      summaryDetail: "detailed",
      asrQuality: "accurate",
      apiKey: "fixture-key",
    });

    const reloaded = new ApplicationSettingsStore(rootDirectory);
    await expect(reloaded.load()).resolves.toMatchObject({
      summaryProvider: "deepseek",
      summaryModel: "deepseek-v4-flash",
      summaryDetail: "detailed",
      asrQuality: "accurate",
    });
    await expect(credentials.read("deepseek")).resolves.toEqual({
      type: "api_key",
      key: "fixture-key",
    });
    await expect(readFile(join(rootDirectory, "auth.json"), "utf8")).resolves.toContain(
      '"type": "api_key"',
    );
    await expect(readFile(join(rootDirectory, "settings.json"), "utf8")).resolves.not.toContain(
      "fixture-key",
    );
  });

  it("retains existing authentication when Options save no replacement key", async () => {
    const rootDirectory = await temporaryDirectory();
    const settingsStore = new ApplicationSettingsStore(rootDirectory);
    const credentials = new FileCredentialStore(rootDirectory);
    const models = builtinModels({ credentials });
    const configuration = new ApplicationConfiguration(models, settingsStore, credentials);

    await credentials.modify("deepseek", async () => ({ type: "api_key", key: "existing-key" }));
    await configuration.save({
      summaryProvider: "deepseek",
      summaryModel: "deepseek-v4-flash",
      summaryDetail: "concise",
      asrQuality: "balanced",
    });

    await expect(credentials.read("deepseek")).resolves.toEqual({
      type: "api_key",
      key: "existing-key",
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "subtext-config-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
