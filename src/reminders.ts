import { App, MarkdownView, Modal, Notice, TFile } from "obsidian";
import { parseReminders } from "./core";
import type { ProdLifeData, ProdLifeSettings, ReminderItem } from "./types";

export class ReminderService {
  private showing = false;

  constructor(
    private app: App,
    private settings: () => ProdLifeSettings,
    private data: () => ProdLifeData,
    private persist: () => Promise<void>
  ) {}

  async scan(): Promise<ReminderItem[]> {
    const reminders: ReminderItem[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      reminders.push(...parseReminders(content, file.path, this.settings().defaultReminderTime));
    }
    return reminders.sort((a, b) => a.due - b.due);
  }

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
    new ReminderModal(this.app, due, {
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
}

interface ReminderActions {
  complete: () => Promise<void>;
  snooze: (minutes: number) => Promise<void>;
  open: () => Promise<void>;
  closed: () => void;
}

class ReminderModal extends Modal {
  constructor(app: App, private item: ReminderItem, private actions: ReminderActions) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("prodlife-reminder-modal");
    this.contentEl.createDiv({ cls: "prodlife-pet prodlife-pet--alert", text: "◆" });
    this.contentEl.createEl("h2", { text: "A gentle nudge" });
    this.contentEl.createEl("p", { cls: "prodlife-reminder-title", text: this.item.text });
    this.contentEl.createEl("small", { text: `Due ${new Date(this.item.due).toLocaleString()}` });
    const actions = this.contentEl.createDiv({ cls: "prodlife-modal-actions" });
    const done = actions.createEl("button", { cls: "mod-cta", text: "Mark done" });
    done.addEventListener("click", async () => { await this.actions.complete(); this.close(); });
    const open = actions.createEl("button", { text: "Open task" });
    open.addEventListener("click", async () => { await this.actions.open(); this.close(); });
    const snooze = this.contentEl.createDiv({ cls: "prodlife-snooze" });
    snooze.createSpan({ text: "Remind me in" });
    for (const [label, minutes] of [["15m", 15], ["1h", 60], ["Tomorrow", 1440]] as const) {
      const button = snooze.createEl("button", { text: label });
      button.addEventListener("click", async () => { await this.actions.snooze(minutes); this.close(); });
    }
  }

  onClose(): void {
    this.actions.closed();
    this.contentEl.empty();
  }
}
