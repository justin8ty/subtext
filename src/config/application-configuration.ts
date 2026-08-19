import type { Api, Model, Models } from "@earendil-works/pi-ai";

import type { TranscriptSummarizer } from "../summary/transcript-summarizer.js";
import {
  PiAiTranscriptSummarizer,
  UnconfiguredTranscriptSummarizer,
} from "../summary/transcript-summarizer.js";
import {
  ApplicationSettingsError,
  ApplicationSettingsStore,
  FileCredentialStore,
  type ApplicationSettings,
  type ApplicationSettingsInput,
} from "./application-settings.js";

export interface ConfigurationProviderOption {
  readonly id: string;
  readonly label: string;
}

export interface ConfigurationModelOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface ConfigurationUpdate extends ApplicationSettingsInput {
  readonly apiKey?: string;
}

export interface ApplicationConfigurationAccess {
  readonly current: ApplicationSettings | null;
  providers(): readonly ConfigurationProviderOption[];
  models(providerId: string): readonly ConfigurationModelOption[];
  save(update: ConfigurationUpdate): Promise<ApplicationSettings>;
}

export class ApplicationConfiguration implements ApplicationConfigurationAccess {
  readonly modelsCollection: Models;
  readonly settingsStore: ApplicationSettingsStore;
  readonly credentials: FileCredentialStore;

  constructor(
    modelsCollection: Models,
    settingsStore: ApplicationSettingsStore,
    credentials: FileCredentialStore,
  ) {
    this.modelsCollection = modelsCollection;
    this.settingsStore = settingsStore;
    this.credentials = credentials;
  }

  get current(): ApplicationSettings | null {
    return this.settingsStore.current;
  }

  providers(): readonly ConfigurationProviderOption[] {
    return this.modelsCollection
      .getProviders()
      .filter(
        (provider) =>
          provider.auth.apiKey !== undefined &&
          this.modelsCollection.getModels(provider.id).length > 0,
      )
      .map((provider) => ({ id: provider.id, label: provider.name }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  models(providerId: string): readonly ConfigurationModelOption[] {
    return this.modelsCollection
      .getModels(providerId)
      .map(modelOption)
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  async save(update: ConfigurationUpdate): Promise<ApplicationSettings> {
    const model = this.modelsCollection.getModel(update.summaryProvider, update.summaryModel);
    if (model === undefined) {
      throw new ApplicationSettingsError(
        `Summary model ${update.summaryProvider}/${update.summaryModel} is not available.`,
      );
    }

    const apiKey = update.apiKey?.trim();
    if (apiKey !== undefined && apiKey !== "") {
      await this.credentials.modify(update.summaryProvider, async () => ({
        type: "api_key",
        key: apiKey,
      }));
    }
    if ((await this.modelsCollection.checkAuth(update.summaryProvider)) === undefined) {
      throw new ApplicationSettingsError(
        `Enter an API key for ${update.summaryProvider}, or configure its provider environment.`,
      );
    }

    return this.settingsStore.save(update);
  }

  createSummarizer(): TranscriptSummarizer {
    const settings = this.current;
    if (settings === null) {
      return new UnconfiguredTranscriptSummarizer();
    }
    const model = this.modelsCollection.getModel(settings.summaryProvider, settings.summaryModel);
    if (model === undefined) {
      return new UnconfiguredTranscriptSummarizer(
        `The configured Summary model ${settings.summaryProvider}/${settings.summaryModel} is not available.`,
      );
    }
    return new PiAiTranscriptSummarizer(this.modelsCollection, model, settings.summaryDetail);
  }
}

function modelOption(model: Model<Api>): ConfigurationModelOption {
  return {
    id: model.id,
    label: model.id,
    description: `${model.name} · ${(model.contextWindow / 1_000).toFixed(0)}k context`,
  };
}
