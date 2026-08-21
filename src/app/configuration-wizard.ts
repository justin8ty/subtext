import {
  CURSOR_MARKER,
  Editor,
  Input,
  Key,
  SelectList,
  Spacer,
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
  ConfigurationAuthentication,
  ConfigurationProviderOption,
  ConfigurationUpdate,
} from "../config/application-configuration.js";
import {
  MAX_SUMMARY_INSTRUCTIONS_LENGTH,
  type SummaryDetail,
} from "../config/application-settings.js";
import type { AsrQuality } from "../runtime/runtime-manifest.js";
import {
  badge,
  KeyHints,
  SectionHeader,
  selectionLabel,
  StatusLine,
  TabBar,
  type KeyHint,
  type UiTone,
} from "./design-system.js";
import { Panel } from "./panel.js";
import { EDITOR_THEME, SELECT_THEME, THEME } from "./theme.js";

type OptionsTab = "models" | "summary" | "asr";
type OptionsScreen =
  | "loading"
  | "providers"
  | "authentication"
  | "models"
  | "summary"
  | "summary-detail"
  | "summary-instructions"
  | "asr"
  | "saving";

type MutableConfigurationUpdate = {
  -readonly [Key in keyof ConfigurationUpdate]: ConfigurationUpdate[Key];
};

const AUTHENTICATION_ACTION = "__authentication";

const TABS = [
  { value: "models", label: "Models" },
  { value: "summary", label: "Summary" },
  { value: "asr", label: "ASR" },
] as const;

export interface ConfigurationWizardOptions {
  readonly required: boolean;
  readonly onSaved: (update: ConfigurationUpdate) => Promise<void>;
  readonly onCancel: () => void;
}

export class ConfigurationWizard extends Panel implements Focusable {
  private readonly tui: TUI;
  private readonly configuration: ApplicationConfigurationAccess;
  private readonly options: ConfigurationWizardOptions;
  private readonly providers: readonly ConfigurationProviderOption[];
  private readonly authentication = new Map<string, ConfigurationAuthentication>();
  private tab: OptionsTab = "models";
  private screen: OptionsScreen = "loading";
  private activeComponent: Component = new Text("", 0, 0);
  private selectedProvider: string;
  private selectedModel: string;
  private pendingApiKey: string | undefined;
  private message: { readonly text: string; readonly tone: UiTone } | null = null;
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
    this.providers = configuration.providers();
    this.selectedProvider = configuration.current?.summaryProvider ?? this.providers[0]?.id ?? "";
    this.selectedModel = configuration.current?.summaryModel ?? "";
    this.setScreen("Loading Options…", new Text("Checking provider authentication.", 1, 0), []);
    void this.loadAuthentication();
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
    if (this.screen === "loading" || this.screen === "saving") {
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.switchTab(1);
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      this.switchTab(-1);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.handleEscape();
      return;
    }
    this.activeComponent.handleInput?.(data);
    this.tui.requestRender();
  }

  private async loadAuthentication(): Promise<void> {
    try {
      await Promise.all(
        this.providers.map(async (provider) => {
          this.authentication.set(
            provider.id,
            await this.configuration.authentication(provider.id),
          );
        }),
      );
    } catch (error) {
      this.setMessage(
        error instanceof Error ? error.message : "Could not inspect provider authentication.",
        "error",
      );
    }
    this.showProviders();
  }

  private switchTab(offset: number): void {
    const currentIndex = TABS.findIndex((tab) => tab.value === this.tab);
    const nextIndex = (currentIndex + offset + TABS.length) % TABS.length;
    this.tab = TABS[nextIndex]?.value ?? "models";
    this.showActiveTab();
  }

  private showActiveTab(): void {
    if (this.tab === "summary") {
      this.showSummary();
      return;
    }
    if (this.tab === "asr") {
      this.showAsr();
      return;
    }
    this.showProviders();
  }

  private handleEscape(): void {
    if (this.screen === "authentication" || this.screen === "models") {
      this.pendingApiKey = undefined;
      this.showProviders();
      return;
    }
    if (this.screen === "summary-detail" || this.screen === "summary-instructions") {
      this.showSummary();
      return;
    }
    if (!this.options.required || this.configuration.current !== null) {
      this.options.onCancel();
    }
  }

  private showProviders(): void {
    this.tab = "models";
    this.screen = "providers";
    const providers = [...this.providers].sort((left, right) => {
      const authenticationDifference =
        Number(this.isAuthenticated(right.id)) - Number(this.isAuthenticated(left.id));
      return authenticationDifference || left.label.localeCompare(right.label);
    });
    if (providers.length === 0) {
      this.setScreen(
        "Summary models",
        new StatusLine("No supported Summary providers are available.", "warning", 1),
        this.rootHints(),
      );
      return;
    }

    const list = new SelectList(
      providers.map((provider) => providerItem(provider, this.authentication, this.configuration)),
      Math.min(10, providers.length),
      SELECT_THEME,
    );
    selectInitial(
      list,
      providers.findIndex((provider) => provider.id === this.selectedProvider),
    );
    list.onSelect = (item) => {
      this.selectedProvider = item.value;
      this.selectedModel =
        this.configuration.current?.summaryProvider === item.value
          ? this.configuration.current.summaryModel
          : "";
      if (this.isAuthenticated(item.value)) {
        this.showModels();
      } else {
        this.showAuthentication();
      }
    };
    list.onCancel = () => this.handleEscape();
    this.setScreen(
      "Summary models",
      list,
      this.rootHints("choose provider · authenticated providers appear first"),
    );
  }

  private showAuthentication(): void {
    this.screen = "authentication";
    const provider = this.providers.find((candidate) => candidate.id === this.selectedProvider);
    const input = new SecretInput();
    input.onSubmit = (value) => {
      const apiKey = value.trim();
      this.pendingApiKey = apiKey === "" ? undefined : apiKey;
      const current = this.configuration.current;
      if (
        this.pendingApiKey !== undefined &&
        current?.summaryProvider === this.selectedProvider &&
        current.summaryModel === this.selectedModel
      ) {
        void this.saveModel();
      } else {
        this.showModels();
      }
    };
    this.setScreen(`Authenticate ${provider?.label ?? this.selectedProvider}`, input, [
      ["Enter", "continue to models"],
      ["Esc", "back"],
      ["Tab", "next section"],
    ]);
  }

  private showModels(): void {
    this.screen = "models";
    const models = this.configuration.models(this.selectedProvider);
    if (models.length === 0) {
      this.setScreen(
        "Choose a Summary model",
        new StatusLine("This provider has no available models.", "warning", 1),
        this.backHints(),
      );
      return;
    }
    const authenticated = this.isAuthenticated(this.selectedProvider);
    const current = this.configuration.current;
    const modelItems = models.map((model) => {
      const selected =
        current?.summaryProvider === this.selectedProvider && current.summaryModel === model.id;
      return {
        value: model.id,
        label: selectionLabel(`${authenticated ? "✓ " : ""}${model.label}`),
        description: `${THEME.muted(model.description)}${selected ? `  ${badge("CURRENT", "accent")}` : ""}`,
      };
    });
    const list = new SelectList(
      [
        ...modelItems,
        {
          value: AUTHENTICATION_ACTION,
          label: selectionLabel(authenticated ? "Update authentication…" : "Enter API key…"),
          description: THEME.muted("Configure provider authentication"),
        },
      ],
      Math.min(10, modelItems.length + 1),
      SELECT_THEME,
    );
    selectInitial(
      list,
      models.findIndex((model) => model.id === this.selectedModel),
    );
    list.onSelect = (item) => {
      if (item.value === AUTHENTICATION_ACTION) {
        this.showAuthentication();
        return;
      }
      this.selectedModel = item.value;
      void this.saveModel();
    };
    list.onCancel = () => this.showProviders();
    this.setScreen("Choose a Summary model", list, this.backHints("save model"));
  }

  private async saveModel(): Promise<void> {
    const update: MutableConfigurationUpdate = {
      summaryProvider: this.selectedProvider,
      summaryModel: this.selectedModel,
      summaryDetail: this.configuration.current?.summaryDetail ?? "standard",
      summaryInstructions: this.configuration.current?.summaryInstructions ?? "",
      asrQuality: this.configuration.current?.asrQuality ?? "balanced",
    };
    if (this.pendingApiKey !== undefined) {
      update.apiKey = this.pendingApiKey;
    }
    await this.saveUpdate(
      update,
      "Summary model saved.",
      () => {
        this.authentication.set(
          this.selectedProvider,
          this.pendingApiKey === undefined
            ? { authenticated: true }
            : { authenticated: true, source: "API key" },
        );
        this.pendingApiKey = undefined;
        this.showModels();
      },
      () => this.showAuthentication(),
    );
  }

  private showSummary(): void {
    this.tab = "summary";
    this.screen = "summary";
    const settings = this.configuration.current;
    const instructions = settings?.summaryInstructions ?? "";
    const list = new SelectList(
      [
        {
          value: "detail",
          label: "Summary detail",
          description: detailLabel(settings?.summaryDetail ?? "standard"),
        },
        {
          value: "instructions",
          label: "Custom instructions",
          description: instructions === "" ? "None" : singleLinePreview(instructions),
        },
      ],
      2,
      SELECT_THEME,
    );
    list.onSelect = (item) => {
      if (item.value === "instructions") {
        this.showSummaryInstructions();
      } else {
        this.showSummaryDetail();
      }
    };
    list.onCancel = () => this.handleEscape();
    this.setScreen("Summary preferences", list, this.rootHints("edit setting"));
  }

  private showSummaryDetail(): void {
    this.screen = "summary-detail";
    const current = this.configuration.current?.summaryDetail ?? "standard";
    const items: readonly SelectItem[] = [
      { value: "concise", label: "Concise", description: "Short overview and key points" },
      { value: "standard", label: "Standard", description: "Balanced default" },
      { value: "detailed", label: "Detailed", description: "More complete supporting detail" },
    ];
    const list = new SelectList(
      items.map((item) => ({
        ...item,
        label: `${item.value === current ? "✓ " : ""}${item.label}`,
      })),
      items.length,
      SELECT_THEME,
    );
    selectInitial(
      list,
      items.findIndex((item) => item.value === current),
    );
    list.onSelect = (item) => void this.saveSummaryDetail(parseSummaryDetail(item.value));
    list.onCancel = () => this.showSummary();
    this.setScreen("Summary detail", list, this.backHints("save detail"));
  }

  private async saveSummaryDetail(summaryDetail: SummaryDetail): Promise<void> {
    const update = this.updateFromCurrent({ summaryDetail });
    if (update === null) {
      this.requireModel();
      return;
    }
    await this.saveUpdate(
      update,
      "Summary detail saved.",
      () => this.showSummary(),
      () => this.showSummaryDetail(),
    );
  }

  private showSummaryInstructions(): void {
    this.screen = "summary-instructions";
    const editor = new Editor(this.tui, EDITOR_THEME, { paddingX: 1 });
    editor.setText(this.configuration.current?.summaryInstructions ?? "");
    editor.onSubmit = (value) => void this.saveSummaryInstructions(value);
    this.setScreen("Custom Summary instructions", editor, [
      ["Enter", "save"],
      ["Shift+Enter", "new line"],
      ["Esc", "back"],
      ["Tab", "next section"],
    ]);
  }

  private async saveSummaryInstructions(value: string): Promise<void> {
    const summaryInstructions = value.trim();
    if (summaryInstructions.length > MAX_SUMMARY_INSTRUCTIONS_LENGTH) {
      this.setMessage(
        `Custom instructions must be ${MAX_SUMMARY_INSTRUCTIONS_LENGTH.toString()} characters or fewer.`,
        "error",
      );
      this.showSummaryInstructions();
      return;
    }
    const update = this.updateFromCurrent({ summaryInstructions });
    if (update === null) {
      this.requireModel();
      return;
    }
    await this.saveUpdate(
      update,
      "Custom Summary instructions saved.",
      () => this.showSummary(),
      () => this.showSummaryInstructions(),
    );
  }

  private showAsr(): void {
    this.tab = "asr";
    this.screen = "asr";
    const current = this.configuration.current?.asrQuality ?? "balanced";
    const items: readonly SelectItem[] = [
      { value: "balanced", label: "Balanced", description: "large-v3-turbo · faster and smaller" },
      { value: "accurate", label: "Accurate", description: "large-v3 · slower and about 3 GB" },
    ];
    const list = new SelectList(
      items.map((item) => ({
        ...item,
        label: `${item.value === current ? "✓ " : ""}${item.label}`,
      })),
      items.length,
      SELECT_THEME,
    );
    selectInitial(
      list,
      items.findIndex((item) => item.value === current),
    );
    list.onSelect = (item) => void this.saveAsr(parseAsrQuality(item.value));
    list.onCancel = () => this.handleEscape();
    this.setScreen("ASR quality", list, this.rootHints("save quality"));
  }

  private async saveAsr(asrQuality: AsrQuality): Promise<void> {
    const update = this.updateFromCurrent({ asrQuality });
    if (update === null) {
      this.requireModel();
      return;
    }
    await this.saveUpdate(
      update,
      "ASR quality saved.",
      () => this.showAsr(),
      () => this.showAsr(),
    );
  }

  private updateFromCurrent(
    changes: Partial<
      Pick<ConfigurationUpdate, "summaryDetail" | "summaryInstructions" | "asrQuality">
    >,
  ): ConfigurationUpdate | null {
    const current = this.configuration.current;
    if (current === null) {
      return null;
    }
    return {
      summaryProvider: current.summaryProvider,
      summaryModel: current.summaryModel,
      summaryDetail: changes.summaryDetail ?? current.summaryDetail,
      summaryInstructions: changes.summaryInstructions ?? current.summaryInstructions,
      asrQuality: changes.asrQuality ?? current.asrQuality,
    };
  }

  private requireModel(): void {
    this.setMessage("Configure a Summary model before saving other Options.", "warning");
    this.showProviders();
  }

  private async saveUpdate(
    update: ConfigurationUpdate,
    successMessage: string,
    onSuccess: () => void,
    onFailure: () => void,
  ): Promise<void> {
    this.screen = "saving";
    this.setScreen("Saving Options…", new Text("Please wait.", 1, 0), []);
    try {
      await this.options.onSaved(update);
      this.setMessage(successMessage, "success");
      onSuccess();
    } catch (error) {
      this.setMessage(error instanceof Error ? error.message : "Could not save Options.", "error");
      onFailure();
    }
    this.tui.requestRender();
  }

  private isAuthenticated(providerId: string): boolean {
    return this.authentication.get(providerId)?.authenticated === true;
  }

  private rootHints(action?: string): readonly KeyHint[] {
    const hints: KeyHint[] = [
      ["↑↓", "navigate"],
      ["Enter", action ?? "select"],
      ["Tab / Shift+Tab", "switch section"],
    ];
    if (!this.options.required || this.configuration.current !== null) {
      hints.push(["Esc", "close"]);
    }
    return hints;
  }

  private backHints(action?: string): readonly KeyHint[] {
    return [
      ["↑↓", "navigate"],
      ["Enter", action ?? "select"],
      ["Esc", "back"],
      ["Tab / Shift+Tab", "switch section"],
    ];
  }

  private setMessage(text: string, tone: UiTone): void {
    this.message = { text, tone };
  }

  private setScreen(title: string, component: Component, hints: readonly KeyHint[]): void {
    if (isFocusableComponent(this.activeComponent)) {
      this.activeComponent.focused = false;
    }
    this.activeComponent = component;
    if (isFocusableComponent(component)) {
      component.focused = this._focused;
    }

    this.clear();
    this.addChild(
      new SectionHeader(
        this.options.required && this.configuration.current === null
          ? "Set up Watchless"
          : "Watchless Options",
        "Configure each section independently",
        1,
      ),
    );
    this.addChild(new Spacer(1));
    this.addChild(new TabBar(TABS, this.tab, 1));
    this.addChild(new Spacer(1));
    this.addChild(new Text(THEME.heading(title), 1, 0));
    if (this.message !== null) {
      this.addChild(new Spacer(1));
      this.addChild(new StatusLine(this.message.text, this.message.tone, 1));
      this.message = null;
    }
    this.addChild(new Spacer(1));
    this.addChild(component);
    if (hints.length > 0) {
      this.addChild(new Spacer(1));
      this.addChild(new KeyHints(hints, { paddingX: 1 }));
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

function providerItem(
  provider: ConfigurationProviderOption,
  authentication: ReadonlyMap<string, ConfigurationAuthentication>,
  configuration: ApplicationConfigurationAccess,
): SelectItem {
  const status = authentication.get(provider.id);
  const authenticated = status?.authenticated === true;
  const current = configuration.current?.summaryProvider === provider.id;
  const details = [
    authenticated ? badge("AUTHENTICATED", "success") : undefined,
    current ? badge("CURRENT", "accent") : undefined,
    status?.source === undefined ? undefined : THEME.muted(status.source),
  ].filter((value): value is string => value !== undefined);
  const item = {
    value: provider.id,
    label: selectionLabel(`${authenticated ? "✓ " : ""}${provider.label}`),
  };
  return details.length === 0 ? item : { ...item, description: details.join("  ") };
}

function selectInitial(list: SelectList, index: number): void {
  if (index >= 0) {
    list.setSelectedIndex(index);
  }
}

function isFocusableComponent(component: Component): component is Component & Focusable {
  return "focused" in component;
}

function detailLabel(detail: SummaryDetail): string {
  if (detail === "concise") {
    return "Concise";
  }
  if (detail === "detailed") {
    return "Detailed";
  }
  return "Standard";
}

function singleLinePreview(value: string): string {
  const singleLine = value.replace(/\s+/gu, " ");
  return singleLine.length <= 72 ? singleLine : `${singleLine.slice(0, 69)}…`;
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
