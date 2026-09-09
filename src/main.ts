import { App, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, setIcon } from "obsidian";
import { ConflictKind, parseConflictName } from "./conflicts";
import { DiffHunk, createHunks } from "./diff";

interface Conflict {
  original: TFile;
  copy: TFile;
  kind: ConflictKind;
  identical: boolean;
}

interface ConflictGroup {
  original: TFile;
  copies: Conflict[];
}

interface MultiwayHunk {
  originalStart: number;
  originalLines: string[];
  variants: Map<string, string[]>;
}

interface DisplayVariant {
  choice: string;
  lines: string[];
  copyIndexes: number[];
}

interface GroupResolution {
  selections: Map<number, string>;
  customTexts: Map<number, string>;
}

interface PluginSettings {
  scanOnStartup: boolean;
  openResolverOnNewConflict: boolean;
  ignoredFolders: string[];
}

const DEFAULT_SETTINGS: PluginSettings = { scanOnStartup: true, openResolverOnNewConflict: false, ignoredFolders: [] };
const CUSTOM_TEXT_CHOICE = "custom-text";

export default class ConflictResolverPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  conflicts: Conflict[] = [];
  private isReadyForConflictAlerts = false;
  private isReviewModalOpen = false;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData() as Partial<PluginSettings> | null) };
    this.addSettingTab(new ConflictResolverSettingTab(this.app, this));
    this.addCommand({ id: "scan-conflicts", name: "Scan for sync conflicts", callback: () => this.scanAndShow() });
    this.addCommand({ id: "resolve-safe-conflicts", name: "Delete identical conflict copies", callback: () => this.deleteIdentical() });
    this.registerEvent(this.app.vault.on("create", () => void this.scan({ alertOnNewConflicts: this.isReadyForConflictAlerts })));
    this.registerEvent(this.app.vault.on("rename", () => void this.scan({ alertOnNewConflicts: this.isReadyForConflictAlerts })));
    this.app.workspace.onLayoutReady(() => {
      this.mountFileExplorerButton();
      if (this.settings.scanOnStartup) void this.scan().finally(() => { this.isReadyForConflictAlerts = true; });
      else this.isReadyForConflictAlerts = true;
    });
  }

  async scan(options: { alertOnNewConflicts?: boolean } = {}): Promise<Conflict[]> {
    const previousConflictPaths = new Set(this.conflicts.map((conflict) => conflict.copy.path));
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
      found.push({ original, copy, kind: parsed.kind, identical: left === right });
    }
    this.conflicts = found.sort((a, b) => a.copy.path.localeCompare(b.copy.path));
    this.updateFileExplorerButton();
    const foundNewConflict = found.some((conflict) => !previousConflictPaths.has(conflict.copy.path));
    if (options.alertOnNewConflicts && this.settings.openResolverOnNewConflict && foundNewConflict) this.openReviewModal();
    return found;
  }

  async scanAndShow(): Promise<void> {
    await this.scan();
    this.openReviewModal();
  }

  private openReviewModal(): void {
    if (this.isReviewModalOpen) return;
    this.isReviewModalOpen = true;
    new ConflictReviewModal(this.app, this, () => { this.isReviewModalOpen = false; }).open();
  }

  async deleteIdentical(): Promise<void> {
    await this.scan();
    const safe = this.conflicts.filter((conflict) => conflict.identical);
    for (const conflict of safe) await this.app.fileManager.trashFile(conflict.copy);
    await this.scan();
    new Notice(safe.length ? `Moved ${safe.length} identical conflict ${safe.length === 1 ? "copy" : "copies"} to the trash.` : "No identical conflict copies found.");
  }

  async keepOriginal(conflict: Conflict): Promise<void> {
    await this.app.fileManager.trashFile(conflict.copy);
    await this.scan();
  }

  getConflictGroups(): ConflictGroup[] {
    const byOriginal = new Map<string, ConflictGroup>();
    for (const conflict of this.conflicts) {
      let group = byOriginal.get(conflict.original.path);
      if (!group) {
        group = { original: conflict.original, copies: [] };
        byOriginal.set(conflict.original.path, group);
      }
      group.copies.push(conflict);
    }
    return [...byOriginal.values()].sort((left, right) => left.original.path.localeCompare(right.original.path));
  }

  async resolveGroup(group: ConflictGroup, hunks: MultiwayHunk[], resolutions: ReadonlyMap<number, string>, customTexts: ReadonlyMap<number, string>): Promise<void> {
    const originalText = await this.app.vault.read(group.original);
    await this.app.vault.modify(group.original, applyMultiwayResolutions(originalText, hunks, resolutions, customTexts));
    for (const conflict of group.copies) await this.app.fileManager.trashFile(conflict.copy);
    await this.scan();
  }

  async removeGroupCopies(group: ConflictGroup): Promise<void> {
    for (const conflict of group.copies) await this.app.fileManager.trashFile(conflict.copy);
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Scan on startup")
      .setDesc("Update the conflict counter when Obsidian starts. Scanning never changes your files.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.scanOnStartup)
        .onChange(async (value) => this.plugin.updateSettings({ ...this.plugin.settings, scanOnStartup: value })));
    new Setting(containerEl)
      .setName("Open resolver for new conflicts")
      .setDesc("Open the review window when a new sync conflict copy appears. This only opens the window; it never changes files.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.openResolverOnNewConflict)
        .onChange(async (value) => this.plugin.updateSettings({ ...this.plugin.settings, openResolverOnNewConflict: value })));
  }
}

interface VariantHunk {
  copyPath: string;
  hunk: DiffHunk;
}

interface HunkRange {
  start: number;
  end: number;
  references: VariantHunk[];
}

function createMultiwayHunks(originalText: string, copies: Array<{ path: string; text: string }>): MultiwayHunk[] {
  const references = copies.flatMap(({ path, text }) => createHunks(originalText, text).map((hunk) => ({ copyPath: path, hunk })));
  const ranges: HunkRange[] = [];
  for (const reference of references.sort((left, right) => left.hunk.originalStart - right.hunk.originalStart)) {
    const start = reference.hunk.originalStart;
    const end = start + reference.hunk.originalLines.length;
    const active = ranges[ranges.length - 1];
    if (active && start <= active.end) {
      active.end = Math.max(active.end, end);
      active.references.push(reference);
    } else {
      ranges.push({ start, end, references: [reference] });
    }
  }
  const originalLines = originalText.split("\n");
  return ranges.map((range) => {
    const variants = new Map<string, string[]>();
    for (const copy of copies) {
      const lines = originalLines.slice(range.start, range.end);
      const copyChanges = range.references
        .filter((reference) => reference.copyPath === copy.path)
        .sort((left, right) => right.hunk.originalStart - left.hunk.originalStart);
      for (const { hunk } of copyChanges) {
        lines.splice(hunk.originalStart - range.start, hunk.originalLines.length, ...hunk.copyLines);
      }
      variants.set(copy.path, lines);
    }
    return { originalStart: range.start, originalLines: originalLines.slice(range.start, range.end), variants };
  });
}

function applyMultiwayResolutions(
  originalText: string,
  hunks: MultiwayHunk[],
  selections: ReadonlyMap<number, string>,
  customTexts: ReadonlyMap<number, string> = new Map()
): string {
  const lines = originalText.split("\n");
  for (let index = hunks.length - 1; index >= 0; index--) {
    const hunk = hunks[index]!;
    const selectedPath = selections.get(index);
    if (!selectedPath || selectedPath === "original") continue;
    const replacement = selectedPath === CUSTOM_TEXT_CHOICE
      ? (customTexts.get(index) === "" ? [] : (customTexts.get(index) ?? hunk.originalLines.join("\n")).split("\n"))
      : (hunk.variants.get(selectedPath) ?? hunk.originalLines);
    lines.splice(hunk.originalStart, hunk.originalLines.length, ...replacement);
  }
  return lines.join("\n");
}

function displayVariants(hunk: MultiwayHunk, group: ConflictGroup): { originalCopyIndexes: number[]; alternatives: DisplayVariant[] } {
  const originalKey = JSON.stringify(hunk.originalLines);
  const originalCopyIndexes: number[] = [];
  const alternatives = new Map<string, DisplayVariant>();
  group.copies.forEach((copy, copyIndex) => {
    const lines = hunk.variants.get(copy.copy.path) ?? hunk.originalLines;
    const key = JSON.stringify(lines);
    if (key === originalKey) {
      originalCopyIndexes.push(copyIndex);
      return;
    }
    const existing = alternatives.get(key);
    if (existing) existing.copyIndexes.push(copyIndex);
    else alternatives.set(key, { choice: copy.copy.path, lines, copyIndexes: [copyIndex] });
  });
  return { originalCopyIndexes, alternatives: [...alternatives.values()] };
}

function copyLabel(copyIndexes: number[]): string {
  const copies = copyIndexes.map((index) => index + 1);
  return copies.length === 1 ? `Copy ${copies[0]}` : `Copies ${copies.join(" + ")}`;
}

class ConflictReviewModal extends Modal {
  private selectedIndex = 0;
  private readonly resolutions = new Map<string, GroupResolution>();
  private previewContext?: { original: string; hunks: MultiwayHunk[]; resolution: GroupResolution };

  constructor(app: App, private readonly plugin: ConflictResolverPlugin, private readonly onModalClose: () => void) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("conflict-resolver-modal");
    this.titleEl.setText("Resolve sync conflicts");
    void this.render();
  }

  onClose(): void {
    this.modalEl.removeClass("conflict-resolver-modal");
    this.onModalClose();
  }

  private async render(): Promise<void> {
    this.contentEl.empty();
    const groups = this.plugin.getConflictGroups();
    const copyCount = this.plugin.conflicts.length;
    if (!groups.length) {
      this.contentEl.createDiv({ cls: "conflict-resolver-empty", text: "No conflict copies found. Nothing was changed." });
      return;
    }
    this.selectedIndex = Math.min(this.selectedIndex, groups.length - 1);
    const intro = this.contentEl.createDiv({ cls: "conflict-resolver-intro" });
    intro.createDiv({ text: `${copyCount} conflict ${copyCount === 1 ? "copy" : "copies"} in ${groups.length} ${groups.length === 1 ? "file" : "files"}` });
    intro.createDiv({ cls: "conflict-resolver-muted", text: "Reviewing is read-only. Files change only after you confirm a resolution." });

    const workspace = this.contentEl.createDiv({ cls: "conflict-resolver-workspace" });
    workspace.toggleClass("is-single-group", groups.length === 1);
    const list = workspace.createDiv({ cls: "conflict-resolver-file-list" });
    groups.forEach((group, index) => {
      const item = list.createEl("button", { cls: "conflict-resolver-file" });
      item.toggleClass("is-active", index === this.selectedIndex);
      item.createDiv({ cls: "conflict-resolver-file-name", text: group.original.name });
      item.createDiv({ cls: "conflict-resolver-file-status", text: `${group.copies.length} ${group.copies.length === 1 ? "copy" : "copies"} · ${group.copies.every((copy) => copy.identical) ? "duplicates" : "needs review"}` });
      item.onclick = () => { this.selectedIndex = index; void this.render(); };
    });
    await this.renderGroup(workspace.createDiv({ cls: "conflict-resolver-detail" }), groups[this.selectedIndex]!);
  }

  private async renderGroup(container: HTMLElement, group: ConflictGroup): Promise<void> {
    const heading = container.createDiv({ cls: "conflict-resolver-heading" });
    heading.createDiv({ cls: "conflict-resolver-path", text: group.original.path });
    heading.createDiv({ cls: "conflict-resolver-muted", text: `${group.copies.length} conflict ${group.copies.length === 1 ? "copy" : "copies"} are compared below. Identical alternatives are grouped together.` });
    const openActions = heading.createDiv({ cls: "conflict-resolver-actions conflict-resolver-open-actions" });
    const openOriginal = openActions.createEl("button", { text: "Open original" });
    openOriginal.onclick = () => void this.app.workspace.getLeaf(false).openFile(group.original);
    const openCopy = openActions.createEl("button", { text: "Open conflict copy…" });
    openCopy.onclick = (event) => {
      const menu = new Menu();
      group.copies.forEach((conflict, index) => {
        menu.addItem((item) => {
          item
            .setTitle(`Copy ${index + 1}: ${conflict.copy.name}`)
            .onClick(() => {
              void this.app.workspace.getLeaf(false).openFile(conflict.copy);
            });
        });
      });
      menu.showAtMouseEvent(event);
    };

    if (group.copies.every((copy) => copy.identical)) {
      container.createDiv({ cls: "conflict-resolver-message is-safe", text: "Every conflict copy has identical content. Removing the copies will not change the original." });
      this.renderFinalAction(container, group, [], { selections: new Map(), customTexts: new Map() });
      return;
    }

    const [original, ...copyTexts] = await Promise.all([this.app.vault.read(group.original), ...group.copies.map((copy) => this.app.vault.read(copy.copy))]);
    const variants = group.copies.map((copy, index) => ({ path: copy.copy.path, text: copyTexts[index]! }));
    const hunks = createMultiwayHunks(original, variants);
    const resolution = this.getResolution(group);
    container.createDiv({ cls: "conflict-resolver-message", text: `${hunks.length} sections contain alternatives from ${group.copies.length} conflict ${group.copies.length === 1 ? "copy" : "copies"}. Click one variant in each section; the preview updates immediately.` });
    this.renderHunks(container, group, hunks, resolution);
    this.renderPreview(container, original, hunks, resolution);
    this.renderFinalAction(container, group, hunks, resolution);
  }

  private getResolution(group: ConflictGroup): GroupResolution {
    let resolution = this.resolutions.get(group.original.path);
    if (!resolution) {
      resolution = { selections: new Map(), customTexts: new Map() };
      this.resolutions.set(group.original.path, resolution);
    }
    return resolution;
  }

  private renderHunks(container: HTMLElement, group: ConflictGroup, hunks: MultiwayHunk[], resolution: GroupResolution): void {
    hunks.forEach((hunk, index) => {
      const block = container.createDiv({ cls: "conflict-resolver-hunk" });
      block.createDiv({ cls: "conflict-resolver-hunk-title", text: `Difference ${index + 1} · around line ${hunk.originalStart + 1}` });
      const variants = displayVariants(hunk, group);
      const comparison = block.createDiv({ cls: "conflict-resolver-diff" });
      comparison.addClass("is-multiway");
      if (variants.alternatives.length > 3) {
        block.createDiv({
          cls: "conflict-resolver-muted conflict-resolver-variant-summary",
          text: `${variants.alternatives.length} distinct alternatives are shown. Copies with the same text are combined in one card.`
        });
      }
      const choice = resolution.selections.get(index) ?? "original";
      const cards = new Map<string, HTMLElement>();
      let customEditor: HTMLTextAreaElement | null = null;
      let updateChoiceNote = (): void => undefined;
      const choose = (selection: string) => {
        resolution.selections.set(index, selection);
        cards.forEach((card, key) => {
          const selected = key === selection;
          card.toggleClass("is-selected", selected);
          card.setAttribute("aria-pressed", String(selected));
        });
        updateChoiceNote();
        this.refreshPreview();
      };
      const editAsCustom = (lines: string[]) => {
        resolution.customTexts.set(index, lines.join("\n"));
        if (customEditor) {
          customEditor.value = lines.join("\n");
          customEditor.focus();
        }
        choose(CUSTOM_TEXT_CHOICE);
      };
      const originalTitle = variants.originalCopyIndexes.length
        ? `Original (same as ${copyLabel(variants.originalCopyIndexes).toLowerCase()})`
        : "Original (currently saved)";
      cards.set("original", this.renderHunkColumn(comparison, originalTitle, hunk.originalLines, "removed", hunk.originalStart + 1, choice === "original", () => choose("original"), () => editAsCustom(hunk.originalLines)));
      variants.alternatives.forEach((variant) => cards.set(variant.choice, this.renderHunkColumn(comparison, copyLabel(variant.copyIndexes), variant.lines, "added", hunk.originalStart + 1, choice === variant.choice, () => choose(variant.choice), () => editAsCustom(variant.lines))));
      const custom = comparison.createDiv({ cls: "conflict-resolver-diff-column conflict-resolver-custom" });
      custom.addClass("is-selectable");
      custom.toggleClass("is-selected", choice === CUSTOM_TEXT_CHOICE);
      custom.setAttribute("role", "button");
      custom.setAttribute("tabindex", "0");
      custom.setAttribute("aria-pressed", String(choice === CUSTOM_TEXT_CHOICE));
      custom.setAttribute("aria-label", "Choose custom text");
      custom.onclick = () => choose(CUSTOM_TEXT_CHOICE);
      custom.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose(CUSTOM_TEXT_CHOICE);
      };
      custom.createDiv({ cls: "conflict-resolver-diff-title", text: "Custom text" });
      const customBody = custom.createDiv({ cls: "conflict-resolver-custom-body" });
      customBody.createDiv({ cls: "conflict-resolver-muted", text: "Write or paste a combined version. An empty selected editor removes this section." });
      customEditor = customBody.createEl("textarea", { cls: "conflict-resolver-custom-editor" });
      customEditor.value = resolution.customTexts.get(index) ?? hunk.originalLines.join("\n");
      customEditor.rows = 4;
      customEditor.onfocus = () => choose(CUSTOM_TEXT_CHOICE);
      customEditor.onkeydown = (event) => event.stopPropagation();
      customEditor.oninput = () => {
        resolution.customTexts.set(index, customEditor!.value);
        this.refreshPreview();
      };
      cards.set(CUSTOM_TEXT_CHOICE, custom);
      const explanation = block.createDiv({ cls: "conflict-resolver-choice-note" });
      updateChoiceNote = () => {
        const selectedChoice = resolution.selections.get(index) ?? "original";
        const selectedVariant = variants.alternatives.find((variant) => variant.choice === selectedChoice);
        explanation.setText(selectedChoice === "original"
          ? variants.originalCopyIndexes.length
            ? `The original text remains; it is also used by ${copyLabel(variants.originalCopyIndexes).toLowerCase()}.`
            : "The original text remains in the saved file."
          : selectedChoice === CUSTOM_TEXT_CHOICE
            ? "Your custom text will be saved for this section."
            : `Text shared by ${copyLabel(selectedVariant?.copyIndexes ?? []).toLowerCase()} will be saved for this section.`);
      };
      updateChoiceNote();
    });
  }

  private renderPreview(container: HTMLElement, original: string, hunks: MultiwayHunk[], resolution: GroupResolution): void {
    this.previewContext = { original, hunks, resolution };
    const selectedCount = [...resolution.selections.values()].filter((choice) => choice !== "original").length;
    const preview = container.createDiv({ cls: "conflict-resolver-preview" });
    preview.createDiv({ cls: "conflict-resolver-preview-title", text: `Saved result preview${selectedCount ? ` · ${selectedCount} section${selectedCount === 1 ? "" : "s"} changed` : " · original unchanged"}` });
    preview.createEl("pre", { cls: "conflict-resolver-preview-code", text: applyMultiwayResolutions(original, hunks, resolution.selections, resolution.customTexts) });
  }

  private refreshPreview(): void {
    if (!this.previewContext) return;
    const { original, hunks, resolution } = this.previewContext;
    const selectedCount = [...resolution.selections.values()].filter((choice) => choice !== "original").length;
    this.contentEl.querySelector<HTMLElement>(".conflict-resolver-preview-title")?.setText(`Saved result preview${selectedCount ? ` · ${selectedCount} section${selectedCount === 1 ? "" : "s"} changed` : " · original unchanged"}`);
    this.contentEl.querySelector<HTMLElement>(".conflict-resolver-preview-code")?.setText(applyMultiwayResolutions(original, hunks, resolution.selections, resolution.customTexts));
  }

  private renderFinalAction(container: HTMLElement, group: ConflictGroup, hunks: MultiwayHunk[], resolution: GroupResolution): void {
    const actions = container.createDiv({ cls: "conflict-resolver-final-actions" });
    const apply = actions.createEl("button", { cls: "mod-cta", text: `Apply resolution and remove ${group.copies.length} conflict ${group.copies.length === 1 ? "copy" : "copies"}` });
    apply.onclick = () => {
      const changed = [...resolution.selections.values()].filter((choice) => choice !== "original").length;
      new ResolutionConfirmModal(this.app, group, changed, async () => {
        if (hunks.length) await this.plugin.resolveGroup(group, hunks, resolution.selections, resolution.customTexts);
        else await this.plugin.removeGroupCopies(group);
        new Notice(`Resolution saved. ${group.copies.length} conflict ${group.copies.length === 1 ? "copy was" : "copies were"} moved to the trash.`);
        await this.render();
      }).open();
    };
    actions.createDiv({ cls: "conflict-resolver-muted", text: `You will confirm before ${group.copies.length === 1 ? "the copy is" : "the copies are"} moved to the trash.` });
  }

  private renderHunkColumn(
    container: HTMLElement,
    title: string,
    lines: string[],
    kind: "added" | "removed",
    startLine: number,
    selected: boolean,
    onSelect: () => void,
    onEditAsCustom: () => void
  ): HTMLElement {
    const column = container.createDiv({ cls: "conflict-resolver-diff-column" });
    column.addClass("is-selectable");
    column.toggleClass("is-selected", selected);
    column.setAttribute("role", "button");
    column.setAttribute("tabindex", "0");
    column.setAttribute("aria-pressed", String(selected));
    column.setAttribute("aria-label", `Choose ${title}`);
    column.onclick = () => {
      const selection = window.getSelection();
      const selectedTextInsideColumn = Boolean(
        selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode
        && column.contains(selection.anchorNode) && column.contains(selection.focusNode)
      );
      if (!selectedTextInsideColumn) onSelect();
    };
    column.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect();
    };
    const titleBar = column.createDiv({ cls: "conflict-resolver-diff-title" });
    titleBar.createSpan({ cls: "conflict-resolver-diff-title-label", text: title });
    const edit = titleBar.createEl("button", { cls: "conflict-resolver-diff-title-action" });
    setIcon(edit, "pencil");
    edit.setAttribute("aria-label", "Edit as custom text");
    edit.setAttribute("title", "Edit as custom text");
    edit.onclick = (event) => {
      event.stopPropagation();
      onEditAsCustom();
    };
    const code = column.createEl("pre", { cls: `conflict-resolver-diff-code is-${kind}` });
    if (!lines.length) code.createDiv({ cls: "conflict-resolver-diff-empty", text: "(no text)" });
    lines.forEach((line, index) => {
      const row = code.createDiv({ cls: `conflict-resolver-diff-line is-${kind}` });
      row.createSpan({ cls: "conflict-resolver-diff-number", text: String(startLine + index) });
      row.createSpan({ cls: "conflict-resolver-diff-text", text: line || " " });
    });
    return column;
  }
}

class ResolutionConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly group: ConflictGroup,
    private readonly changedSections: number,
    private readonly onConfirm: () => Promise<void>
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Apply this resolution?");
    this.contentEl.createDiv({ cls: "conflict-resolver-confirm-summary", text: this.changedSections
      ? `${this.changedSections} selected ${this.changedSections === 1 ? "section" : "sections"} will be written to the original file.`
      : "The original file will stay exactly as it is." });
    const changes = this.contentEl.createDiv({ cls: "conflict-resolver-confirm-list" });
    changes.createDiv({ text: `Original: ${this.group.original.path}` });
    this.group.copies.forEach((conflict) => changes.createDiv({ text: `Moved to trash: ${conflict.copy.path}` }));
    const actions = this.contentEl.createDiv({ cls: "conflict-resolver-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const confirm = actions.createEl("button", { cls: "mod-warning", text: `Apply & move ${this.group.copies.length} ${this.group.copies.length === 1 ? "copy" : "copies"} to trash` });
    confirm.onclick = () => void this.perform(confirm, cancel);
  }

  private async perform(confirm: HTMLButtonElement, cancel: HTMLButtonElement): Promise<void> {
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      await this.onConfirm();
      this.close();
    } catch (error) {
      new Notice(`Could not apply resolution: ${error instanceof Error ? error.message : String(error)}`);
      confirm.disabled = false;
      cancel.disabled = false;
    }
  }
}
