import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { ConflictKind, isCopyContainedInOriginal, parseConflictName } from "./conflicts";
import { DiffHunk, applyCopyHunks, createHunks } from "./diff";

interface Conflict {
  original: TFile;
  copy: TFile;
  kind: ConflictKind;
  identical: boolean;
}

interface PluginSettings {
  scanOnStartup: boolean;
  autoDeleteContainedCopies: boolean;
  ignoredFolders: string[];
}

const DEFAULT_SETTINGS: PluginSettings = { scanOnStartup: true, autoDeleteContainedCopies: false, ignoredFolders: [] };

export default class ConflictResolverPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  conflicts: Conflict[] = [];

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData() as Partial<PluginSettings> | null) };
    this.addSettingTab(new ConflictResolverSettingTab(this.app, this));
    this.addCommand({ id: "scan-conflicts", name: "Scan for sync conflicts", callback: () => this.scanAndShow() });
    this.addCommand({ id: "resolve-safe-conflicts", name: "Delete identical conflict copies", callback: () => this.deleteIdentical() });
    this.registerEvent(this.app.vault.on("create", () => void this.scan()));
    this.registerEvent(this.app.vault.on("rename", () => void this.scan()));
    this.app.workspace.onLayoutReady(() => {
      this.mountFileExplorerButton();
      if (this.settings.scanOnStartup) void this.scan();
    });
  }

  async scan(): Promise<Conflict[]> {
    const files = this.app.vault.getFiles();
    const byPath = new Map(files.map((file) => [file.path, file]));
    const found: Conflict[] = [];
    for (const copy of files) {
      if (this.isIgnored(copy.path)) continue;
      const parsed = parseConflictName(copy.name);
      if (!parsed) continue;
      const originalPath = normalizePath(`${copy.parent?.path ?? ""}/${parsed.canonicalName}`);
      const original = byPath.get(originalPath);
      if (!original || original.path === copy.path) continue;
      const [left, right] = await Promise.all([this.app.vault.read(original), this.app.vault.read(copy)]);
      // A non-empty conflict copy already fully present in the canonical file
      // cannot contribute unique text, so it is safe to remove automatically.
      if (this.settings.autoDeleteContainedCopies && isCopyContainedInOriginal(left, right)) {
        await this.app.fileManager.trashFile(copy);
        continue;
      }
      found.push({ original, copy, kind: parsed.kind, identical: left === right });
    }
    this.conflicts = found.sort((a, b) => a.copy.path.localeCompare(b.copy.path));
    this.updateFileExplorerButton();
    return found;
  }

  async scanAndShow(): Promise<void> {
    await this.scan();
    new ConflictReviewModal(this.app, this).open();
  }

  async deleteIdentical(): Promise<void> {
    await this.scan();
    const safe = this.conflicts.filter((conflict) => conflict.identical);
    for (const conflict of safe) await this.app.fileManager.trashFile(conflict.copy);
    await this.scan();
    new Notice(safe.length ? `Deleted ${safe.length} identical conflict ${safe.length === 1 ? "copy" : "copies"}.` : "No identical conflict copies found.");
  }

  async keepOriginal(conflict: Conflict): Promise<void> {
    await this.app.fileManager.trashFile(conflict.copy);
    await this.scan();
  }

  async resolveHunks(conflict: Conflict, hunks: DiffHunk[], useCopy: ReadonlySet<number>): Promise<void> {
    const originalText = await this.app.vault.read(conflict.original);
    await this.app.vault.modify(conflict.original, applyCopyHunks(originalText, hunks, useCopy));
    await this.app.fileManager.trashFile(conflict.copy);
    await this.scan();
  }

  async updateSettings(settings: PluginSettings): Promise<void> {
    this.settings = settings;
    await this.saveData(this.settings);
    await this.scan();
  }

  private isIgnored(path: string): boolean { return this.settings.ignoredFolders.some((folder) => path === folder || path.startsWith(`${folder}/`)); }

  private mountFileExplorerButton(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const container = leaf.view.containerEl;
      if (container.querySelector(".conflict-resolver-footer")) continue;
      const footer = container.createDiv({ cls: "conflict-resolver-footer" });
      const button = footer.createEl("button", { cls: "mod-cta", text: "Scan conflicts" });
      button.addEventListener("click", () => void this.scanAndShow());
    }
    this.updateFileExplorerButton();
  }

  private updateFileExplorerButton(): void {
    for (const footer of Array.from(document.querySelectorAll<HTMLElement>(".conflict-resolver-footer"))) {
      footer.toggleClass("is-hidden", this.conflicts.length === 0);
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".conflict-resolver-footer button"))) {
      button.setText(`Resolve conflicts (${this.conflicts.length})`);
      button.addClass("mod-cta");
    }
  }
}

class ConflictResolverSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ConflictResolverPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Delete copies already contained in the original",
        desc: "During scans, automatically delete a non-empty conflict copy when every non-empty line is already present in the original file in the same order.",
        control: { type: "toggle", key: "autoDeleteContainedCopies" }
      },
      {
        name: "Scan on startup",
        desc: "Update the conflict counter when Obsidian starts.",
        control: { type: "toggle", key: "scanOnStartup" }
      }
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "autoDeleteContainedCopies" || key === "scanOnStartup") return this.plugin.settings[key];
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if ((key !== "autoDeleteContainedCopies" && key !== "scanOnStartup") || typeof value !== "boolean") return;
    await this.plugin.updateSettings({ ...this.plugin.settings, [key]: value });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Delete copies already contained in the original")
      .setDesc("During scans, automatically delete a non-empty conflict copy when every non-empty line is already present in the original file in the same order.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoDeleteContainedCopies)
        .onChange(async (value) => this.plugin.updateSettings({ ...this.plugin.settings, autoDeleteContainedCopies: value })));
    new Setting(containerEl)
      .setName("Scan on startup")
      .setDesc("Update the conflict counter when Obsidian starts.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.scanOnStartup)
        .onChange(async (value) => this.plugin.updateSettings({ ...this.plugin.settings, scanOnStartup: value })));
  }
}

class ConflictReviewModal extends Modal {
  private selectedCopyHunks = new Set<number>();
  private hunks: DiffHunk[] = [];

  constructor(app: App, private readonly plugin: ConflictResolverPlugin) { super(app); }

  onOpen(): void {
    this.titleEl.setText(`Sync conflicts (${this.plugin.conflicts.length})`);
    const content = this.contentEl.createDiv({ cls: "conflict-resolver-list" });
    if (!this.plugin.conflicts.length) { content.createDiv({ cls: "conflict-resolver-empty", text: "No conflict copies found." }); return; }
    void this.renderConflict(content, this.plugin.conflicts[0]!);
  }

  private async renderConflict(container: HTMLElement, conflict: Conflict): Promise<void> {
    const item = container.createDiv({ cls: "conflict-resolver-item" });
    item.createDiv({ cls: "conflict-resolver-path", text: conflict.original.path });
    if (!conflict.identical) {
      const [original, copy] = await Promise.all([this.app.vault.read(conflict.original), this.app.vault.read(conflict.copy)]);
      this.hunks = createHunks(original, copy);
      this.selectedCopyHunks = new Set();
      this.renderHunks(item, this.hunks);
    }
    const actions = item.createDiv({ cls: "conflict-resolver-actions" });
    const keepOriginal = actions.createEl("button", { text: conflict.identical ? "Delete duplicate" : "Keep original" });
    keepOriginal.onclick = () => void this.perform(async () => this.plugin.keepOriginal(conflict));
    if (!conflict.identical) {
      const apply = actions.createEl("button", { cls: "mod-cta", text: "Apply selected changes and delete copy" });
      apply.onclick = () => void this.perform(async () => this.plugin.resolveHunks(conflict, this.hunks, this.selectedCopyHunks));
    }
  }

  private renderHunks(container: HTMLElement, hunks: DiffHunk[]): void {
    hunks.forEach((hunk, index) => {
      const block = container.createDiv({ cls: "conflict-resolver-hunk" });
      block.createDiv({ cls: "conflict-resolver-hunk-title", text: `Difference ${index + 1}` });
      const comparison = block.createDiv({ cls: "conflict-resolver-diff" });
      this.renderHunkColumn(comparison, "Main file", hunk.originalLines, "removed");
      this.renderHunkColumn(comparison, "Copy", hunk.copyLines, "added");
      const choices = block.createDiv({ cls: "conflict-resolver-actions" });
      const keepMain = choices.createEl("button", { text: "Keep main" });
      const useCopy = choices.createEl("button", { text: "Use copy" });
      const update = (copySelected: boolean): void => {
        if (copySelected) this.selectedCopyHunks.add(index); else this.selectedCopyHunks.delete(index);
        keepMain.toggleClass("is-selected", !copySelected);
        useCopy.toggleClass("is-selected", copySelected);
      };
      keepMain.onclick = () => update(false);
      useCopy.onclick = () => update(true);
      update(false);
    });
  }

  private renderHunkColumn(container: HTMLElement, title: string, lines: string[], kind: "added" | "removed"): void {
    const column = container.createDiv({ cls: "conflict-resolver-diff-column" });
    column.createDiv({ cls: "conflict-resolver-diff-title", text: title });
    const code = column.createEl("pre", { cls: `conflict-resolver-diff-code is-${kind}` });
    code.setText(lines.join("\n"));
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    await action();
    this.close();
    new ConflictReviewModal(this.app, this.plugin).open();
  }
}
