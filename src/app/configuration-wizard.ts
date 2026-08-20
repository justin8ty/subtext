import {
  CURSOR_MARKER,
  Container,
  Input,
  Key,
  SelectList,
  Text,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";

import type {
  ApplicationConfigurationAccess,
  ConfigurationUpdate,
} from "../config/application-configuration.js";
import type { SummaryDetail } from "../config/application-settings.js";
import type { AsrQuality } from "../runtime/runtime-manifest.js";
import { bold, dim, error, SELECT_THEME } from "./theme.js";

type WizardStep = "provider" | "authentication" | "model" | "detail" | "asr" | "saving";
type MutableConfigurationUpdate = {
  -readonly [Key in keyof ConfigurationUpdate]: ConfigurationUpdate[Key];
};

export interface ConfigurationWizardOptions {
  readonly required: boolean;
  readonly onSaved: (update: ConfigurationUpdate) => Promise<void>;
  readonly onCancel: () => void;
}

export class ConfigurationWizard extends Container implements Focusable {
  private readonly tui: TUI;
  private readonly configuration: ApplicationConfigurationAccess;
  private readonly options: ConfigurationWizardOptions;
  private step: WizardStep = "provider";
  private activeComponent: Component;
  private selectedProvider: string;
  private selectedModel: string;
  private apiKey: string | undefined;
  private message = "";
  private _focused = false;

  constructor(
    tui: TUI,
    configuration: ApplicationConfigurationAccess,
    options: ConfigurationWizardOptions,
  ) {
    super();
    this.tui = tui;
    this.configuration = configuration;
    this.options = options;
    const providers = configuration.providers();
    this.selectedProvider = configuration.current?.summaryProvider ?? providers[0]?.id ?? "";
    this.selectedModel = configuration.current?.summaryModel ?? "";
    this.activeComponent = new Text("", 0, 0);
    this.showProvider();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (isFocusableComponent(this.activeComponent)) {
      this.activeComponent.focused = value;
    }
  }

  handleInput(data: string): void {
    if (this.step === "saving") {
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (!this.options.required) {
        this.options.onCancel();
      }
      return;
    }
    this.activeComponent.handleInput?.(data);
    this.tui.requestRender();
  }

  private showProvider(): void {
    this.step = "provider";
    const providers = this.configuration.providers();
    const list = new SelectList(
      providers.map((provider) => ({ value: provider.id, label: provider.label })),
      Math.min(10, Math.max(1, providers.length)),
      SELECT_THEME,
    );
    selectInitial(
      list,
      providers.findIndex((provider) => provider.id === this.selectedProvider),
    );
    list.onSelect = (item) => {
      this.selectedProvider = item.value;
      const configuredModel =
        this.configuration.current?.summaryProvider === item.value
          ? this.configuration.current.summaryModel
          : undefined;
      this.selectedModel = configuredModel ?? "";
      this.showAuthentication();
    };
    this.setScreen("Summary provider", list, "↑↓ navigate · enter select · esc close");
  }

  private showAuthentication(): void {
    this.step = "authentication";
    const input = new SecretInput();
    input.onSubmit = (value) => {
      this.apiKey = value.trim() === "" ? undefined : value.trim();
      this.showModel();
    };
    this.setScreen(
      `API key for ${this.selectedProvider}`,
      input,
      "Key is hidden · leave blank to keep existing/environment auth · enter continue",
    );
  }

  private showModel(): void {
    this.step = "model";
    const models = this.configuration.models(this.selectedProvider);
    const list = new SelectList(
      models.map((model) => ({
        value: model.id,
        label: model.label,
        description: model.description,
      })),
      Math.min(10, Math.max(1, models.length)),
      SELECT_THEME,
    );
    selectInitial(
      list,
      models.findIndex((model) => model.id === this.selectedModel),
    );
    list.onSelect = (item) => {
      this.selectedModel = item.value;
      this.showDetail();
    };
    this.setScreen("Summary model", list, "↑↓ navigate · enter select · esc close");
  }

  private showDetail(): void {
    this.step = "detail";
    const items: readonly SelectItem[] = [
      { value: "concise", label: "Concise", description: "Short overview and key points" },
      { value: "standard", label: "Standard", description: "Balanced default" },
      { value: "detailed", label: "Detailed", description: "More complete supporting detail" },
    ];
    const list = new SelectList([...items], items.length, SELECT_THEME);
    const current = this.configuration.current?.summaryDetail ?? "standard";
    selectInitial(
      list,
      items.findIndex((item) => item.value === current),
    );
    list.onSelect = (item) => this.showAsr(parseSummaryDetail(item.value));
    this.setScreen("Summary detail", list, "↑↓ navigate · enter select · esc close");
  }

  private showAsr(summaryDetail: SummaryDetail): void {
    this.step = "asr";
    const items: readonly SelectItem[] = [
      { value: "balanced", label: "Balanced", description: "large-v3-turbo; faster and smaller" },
      { value: "accurate", label: "Accurate", description: "large-v3; slower and about 3 GB" },
    ];
    const list = new SelectList([...items], items.length, SELECT_THEME);
    const current = this.configuration.current?.asrQuality ?? "balanced";
    selectInitial(
      list,
      items.findIndex((item) => item.value === current),
    );
    list.onSelect = (item) => {
      void this.save(summaryDetail, parseAsrQuality(item.value));
    };
    this.setScreen("ASR quality", list, "↑↓ navigate · enter save · esc close");
  }

  private async save(summaryDetail: SummaryDetail, asrQuality: AsrQuality): Promise<void> {
    this.step = "saving";
    this.setScreen("Saving Options…", new Text("Please wait.", 0, 0), "");
    try {
      const update: MutableConfigurationUpdate = {
        summaryProvider: this.selectedProvider,
        summaryModel: this.selectedModel,
        summaryDetail,
        asrQuality,
      };
      if (this.apiKey !== undefined) {
        update.apiKey = this.apiKey;
      }
      await this.options.onSaved(update);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Could not save Options.";
      this.showAuthentication();
    }
    this.tui.requestRender();
  }

  private setScreen(title: string, component: Component, help: string): void {
    if (isFocusableComponent(this.activeComponent)) {
      this.activeComponent.focused = false;
    }
    this.activeComponent = component;
    if (isFocusableComponent(component)) {
      component.focused = this._focused;
    }
    this.clear();
    this.addChild(
      new Text(bold(this.options.required ? "Set up Subtext" : "Subtext Options"), 1, 0),
    );
    this.addChild(new Text(bold(title), 1, 0));
    if (this.message !== "") {
      this.addChild(new Text(error(this.message), 1, 0));
      this.message = "";
    }
    this.addChild(component);
    if (help !== "") {
      this.addChild(new Text(dim(help), 1, 0));
    }
    this.tui.requestRender();
  }
}

class SecretInput implements Component, Focusable {
  private readonly input = new Input();
  focused = false;
  onSubmit?: (value: string) => void;

  constructor() {
    this.input.onSubmit = (value) => this.onSubmit?.(value);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }
    const length = this.input.getValue().length;
    const bullets = length === 0 ? "" : "•".repeat(Math.min(length, Math.max(1, width)));
    return [truncateToWidth(`${bullets}${this.focused ? CURSOR_MARKER : ""}`, width, "")];
  }

  invalidate(): void {
    this.input.invalidate();
  }
}

function selectInitial(list: SelectList, index: number): void {
  if (index >= 0) {
    list.setSelectedIndex(index);
  }
}

function isFocusableComponent(component: Component): component is Component & Focusable {
  return "focused" in component;
}

function parseSummaryDetail(value: string): SummaryDetail {
  if (value === "concise" || value === "detailed") {
    return value;
  }
  return "standard";
}

function parseAsrQuality(value: string): AsrQuality {
  return value === "accurate" ? "accurate" : "balanced";
}
