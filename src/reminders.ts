import { App, Editor, MarkdownView, Modal, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { parseReminders, upsertReminder } from "./core";
import type { ProdLifeData, ProdLifeSettings, ReminderItem } from "./types";

export class ReminderService {
  private showing = false;
  private dirty = true;
  private cached: ReminderItem[] = [];

  constructor(
    private app: App,
    private settings: () => ProdLifeSettings,
    private data: () => ProdLifeData,
    private persist: () => Promise<void>
  ) {}

  async scan(): Promise<ReminderItem[]> {
    if (!this.dirty) return this.cached;
    const reminders: ReminderItem[] = [];
    for (const file of this.reminderFiles()) {
      const content = await this.app.vault.cachedRead(file);
      reminders.push(...parseReminders(content, file.path, this.settings().defaultReminderTime));
    }
    this.cached = reminders.sort((a, b) => a.due - b.due);
    this.dirty = false;
    return this.cached;
  }

  invalidate(): void { this.dirty = true; }

  async checkDue(): Promise<void> {
    if (!this.settings().remindersEnabled || this.showing) return;
    const now = Date.now();
    const state = this.data();
    const due = (await this.scan()).find((item) =>
      !item.completed
      && item.due <= now
      && (state.snoozedUntil[item.id] ?? 0) <= now
      && now - (state.notified[item.id] ?? 0) > 12 * 60 * 60 * 1000
    );
    if (!due) return;
    this.showing = true;
    state.notified[due.id] = now;
    await this.persist();
    new ReminderModal(this.app, due, this.settings().snoozeMinutes, {
      complete: async () => this.complete(due),
      snooze: async (minutes) => this.snooze(due, minutes),
      open: async () => this.open(due),
      closed: () => { this.showing = false; }
    }).open();
  }

  async complete(item: ReminderItem): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (content) => {
      const lines = content.split("\n");
      const line = lines[item.line];
      if (line) lines[item.line] = line.replace(/^(\s*[-*+]\s+)\[[^\]]\]/, "$1[x]");
      return lines.join("\n");
    });
    delete this.data().snoozedUntil[item.id];
    new Notice(`Completed: ${item.text}`);
    await this.persist();
  }

  async snooze(item: ReminderItem, minutes: number): Promise<void> {
    this.data().snoozedUntil[item.id] = Date.now() + minutes * 60_000;
    delete this.data().notified[item.id];
    await this.persist();
    new Notice(`${this.settings().petName} will remind you again in ${minutes} minutes.`);
  }

  async open(item: ReminderItem): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(false).openFile(file);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    view?.setEphemeralState({ line: item.line });
    view?.editor.setCursor({ line: item.line, ch: 0 });
    view?.editor.scrollIntoView({ from: { line: item.line, ch: 0 }, to: { line: item.line, ch: 0 } }, true);
  }

  editCurrentLine(editor: Editor): void {
    new ReminderEditorModal(this.app, editor, this.settings().defaultReminderTime, this.settings().linkReminderDates, () => this.invalidate()).open();
  }

  private reminderFiles(): TFile[] {
    const folders = this.settings().reminderFolders.map((path) => normalizePath(path.trim())).filter(Boolean);
    if (!folders.length) return this.app.vault.getMarkdownFiles();
    const files: TFile[] = [];
    const visit = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "md") files.push(child);
        else if (child instanceof TFolder) visit(child);
      }
    };
    for (const path of folders) {
      const item = this.app.vault.getAbstractFileByPath(path);
      if (item instanceof TFile && item.extension === "md") files.push(item);
      else if (item instanceof TFolder) visit(item);
    }
    return [...new Map(files.map((file) => [file.path, file])).values()];
  }
}

interface ReminderActions {
  complete: () => Promise<void>;
  snooze: (minutes: number) => Promise<void>;
  open: () => Promise<void>;
  closed: () => void;
}

class ReminderModal extends Modal {
  constructor(app: App, private item: ReminderItem, private snoozeMinutes: number[], private actions: ReminderActions) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("prodlife-reminder-modal");
    this.contentEl.createDiv({ cls: "prodlife-pet prodlife-pet--alert", text: "◆" });
    this.contentEl.createEl("h2", { text: "A gentle nudge" });
    this.contentEl.createEl("p", { cls: "prodlife-reminder-title", text: this.item.text });
    this.contentEl.createEl("small", { text: `Due ${new Date(this.item.due).toLocaleString()}` });
    const actions = this.contentEl.createDiv({ cls: "prodlife-modal-actions" });
    const done = actions.createEl("button", { cls: "mod-cta", text: "Mark done" });
    done.addEventListener("click", () => { void this.actions.complete().then(() => this.close()); });
    const open = actions.createEl("button", { text: "Open task" });
    open.addEventListener("click", () => { void this.actions.open().then(() => this.close()); });
    const snooze = this.contentEl.createDiv({ cls: "prodlife-snooze" });
    snooze.createSpan({ text: "Remind me in" });
    for (const minutes of this.snoozeMinutes) {
      const button = snooze.createEl("button", { text: snoozeLabel(minutes) });
      button.addEventListener("click", () => { void this.actions.snooze(minutes).then(() => this.close()); });
    }
  }

  onClose(): void {
    this.actions.closed();
    this.contentEl.empty();
  }
}

class ReminderEditorModal extends Modal {
  constructor(
    app: App,
    private editor: Editor,
    private defaultTime: string,
    private linkDate: boolean,
    private changed: () => void
  ) { super(app); }

  onOpen(): void {
    const cursor = this.editor.getCursor();
    const line = this.editor.getLine(cursor.line);
    const existing = parseReminders(line, "current", this.defaultTime)[0];
    const due = existing ? new Date(existing.due) : new Date();
    const date = this.contentEl.createEl("input", { type: "date", value: localDate(due) });
    const time = this.contentEl.createEl("input", { type: "time", value: existing ? localTime(due) : this.defaultTime });
    this.contentEl.createEl("h2", { text: existing ? "Edit reminder" : "Add reminder" });
    const fields = this.contentEl.createDiv({ cls: "prodlife-reminder-fields" });
    fields.append(date, time);
    const actions = this.contentEl.createDiv({ cls: "prodlife-modal-actions" });
    const save = actions.createEl("button", { cls: "mod-cta", text: "Save reminder" });
    save.addEventListener("click", () => {
      if (!date.value) {
        new Notice("Choose a reminder date.");
        return;
      }
      this.editor.setLine(cursor.line, upsertReminder(line, date.value, time.value, this.linkDate));
      this.changed();
      this.close();
    });
    window.setTimeout(() => date.focus(), 0);
  }
}

const localDate = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localTime = (date: Date): string => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const snoozeLabel = (minutes: number): string => minutes % 10080 === 0
  ? `${minutes / 10080}w`
  : minutes % 1440 === 0
    ? `${minutes / 1440}d`
    : minutes % 60 === 0
      ? `${minutes / 60}h`
      : `${minutes}m`;
