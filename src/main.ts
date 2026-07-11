import { Notice, Plugin, TAbstractFile, TFile, normalizePath } from "obsidian";
import { DailyNotesService } from "./daily-notes";
import { AchievementUnlockModal, DASHBOARD_VIEW, DashboardView, openDashboardLayout } from "./dashboard";
import { REMINDER_VIEW, ReminderListView } from "./reminder-view";
import { ReminderService } from "./reminders";
import { ProdLifeSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type Achievement, type ProdLifeData, type ProdLifeSettings } from "./types";
import { WritingTracker } from "./writing";

export default class ProdLifePlugin extends Plugin {
  settings: ProdLifeSettings = { ...DEFAULT_SETTINGS };
  private data: ProdLifeData = { settings: this.settings, snoozedUntil: {}, notified: {}, writingHistory: {}, writingFiles: {}, writingInitialized: false, achievementUnlocks: {}, achievementsInitialized: false };
  private daily!: DailyNotesService;
  private reminders!: ReminderService;
  private writing!: WritingTracker;
  private renderTimer: number | null = null;
  private achievementQueue: Achievement[] = [];
  private achievementShowing = false;
  private petPopup: HTMLElement | null = null;
  private petTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.daily = new DailyNotesService(this.app, () => this.settings);
    this.reminders = new ReminderService(this.app, () => this.settings, () => this.data, () => this.persistData(), this);
    this.writing = new WritingTracker(this.app, () => this.settings, () => this.data, () => this.persistData(), (file) => {
      const frontmatterDate: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.date;
      return typeof frontmatterDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(frontmatterDate) ? frontmatterDate : this.daily.dateFor(file);
    });
    this.reminders.delayUntil(Date.now() + this.settings.startupDelaySeconds * 1000);

    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this.daily, this.reminders, this.writing, () => this.settings, () => this.data, () => this.saveSettings(), (achievements) => this.recordAchievements(achievements)));
    this.registerView(REMINDER_VIEW, (leaf) => new ReminderListView(leaf, this.reminders));
    this.addSettingTab(new ProdLifeSettingTab(this.app, this));

    this.addRibbonIcon("calendar-check", "Open today's ProdLife note", () => void this.daily.open());
    this.addRibbonIcon("sprout", "Open ProdLife dashboard", () => void this.activateDashboard());
    this.addRibbonIcon("alarm-clock", "Open ProdLife reminders", () => void this.activateReminders());
    this.addCommand({ id: "open-today", name: "Open today's note", callback: () => void this.daily.open() });
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.activateDashboard() });
    this.addCommand({ id: "open-reminders", name: "Open reminder sidebar", callback: () => void this.activateReminders() });
    this.addCommand({ id: "scan-reminders", name: "Scan reminders now", callback: async () => {
      const count = (await this.reminders.scan()).filter((item) => !item.completed).length;
      new Notice(`ProdLife found ${count} open reminder${count === 1 ? "" : "s"}.`);
      await this.reminders.checkDue();
    }});
    this.addCommand({ id: "set-reminder", name: "Set reminder on current line", editorCallback: (editor) => this.reminders.editCurrentLine(editor) });
    this.addCommand({ id: "import-workflow", name: "Import Daily Notes and Reminder settings", callback: () => void this.importLegacySettings() });
    this.addCommand({ id: "archive-old-notes", name: "Archive old daily notes", callback: () => void this.daily.archiveOldNotes() });
    this.addCommand({ id: "pet-check-in", name: "Ask your productivity pet", callback: () => this.petCheckIn() });

    const status = this.addStatusBarItem();
    status.addClass("prodlife-status-pet");
    status.setText(`◆ ${this.settings.petName}`);
    status.setAttr("aria-label", `Ask ${this.settings.petName} for a check-in`);
    status.addEventListener("click", () => this.petCheckIn());
    this.register(() => this.dismissPet());

    this.registerEvent(this.app.vault.on("modify", (file) => { this.onVaultChange(file); if (file instanceof TFile) this.writing.schedule(file); }));
    this.registerEvent(this.app.vault.on("create", (file) => { this.onVaultChange(file); if (file instanceof TFile) this.writing.schedule(file); }));
    this.registerEvent(this.app.vault.on("delete", (file) => { if (file instanceof TFile) this.writing.remove(file.path); this.onVaultChange(file); }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { if (file instanceof TFile) this.writing.rename(file, oldPath); this.onVaultChange(file); }));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      menu.addItem((item) => item.setTitle("Set ProdLife reminder").setIcon("alarm-clock-plus").onClick(() => this.reminders.editCurrentLine(editor)));
    }));
    this.registerInterval(window.setInterval(() => void this.reminders.checkDue(), Math.max(15, this.settings.reminderIntervalSeconds) * 1000));
    this.registerInterval(window.setInterval(() => this.petCheckIn(true), Math.max(30, this.settings.petCheckInMinutes) * 60_000));
    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => {
        void this.writing.initialize().then(async () => {
          await this.daily.autoArchive();
          await this.reminders.checkDue();
          await this.refreshViews();
        });
      }, this.settings.startupDelaySeconds * 1000);
    });
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<ProdLifeData> | null;
    const hasStoredSettings = stored?.settings !== undefined;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(stored?.settings ?? {}),
      weekdayTemplates: { ...DEFAULT_SETTINGS.weekdayTemplates, ...(stored?.settings?.weekdayTemplates ?? {}) },
      reminderFolders: stored?.settings?.reminderFolders?.filter((path): path is string => typeof path === "string") ?? DEFAULT_SETTINGS.reminderFolders,
      snoozeMinutes: stored?.settings?.snoozeMinutes?.filter((minutes): minutes is number => typeof minutes === "number" && minutes > 0) ?? DEFAULT_SETTINGS.snoozeMinutes,
      dashboardSections: stored?.settings?.dashboardSections?.filter((section): section is ProdLifeSettings["dashboardSections"][number] => ["hero", "metrics", "heatmap", "achievements", "reminders"].includes(section)) ?? DEFAULT_SETTINGS.dashboardSections,
      writingFolders: stored?.settings?.writingFolders?.filter((path): path is string => typeof path === "string") ?? DEFAULT_SETTINGS.writingFolders,
      quotes: stored?.settings?.quotes?.length ? stored.settings.quotes : DEFAULT_SETTINGS.quotes
    };
    this.data = {
      settings: this.settings,
      snoozedUntil: stored?.snoozedUntil ?? {},
      notified: stored?.notified ?? {},
      writingHistory: stored?.writingHistory ?? {},
      writingFiles: stored?.writingFiles ?? {},
      writingInitialized: stored?.writingInitialized ?? false,
      achievementUnlocks: stored?.achievementUnlocks ?? {},
      achievementsInitialized: stored?.achievementsInitialized ?? false
    };
    if (!hasStoredSettings) await this.importLegacySettings(false);
  }

  async saveSettings(): Promise<void> {
    this.data.settings = this.settings;
    this.reminders?.invalidate();
    await this.persistData();
  }

  async importLegacySettings(showNotice = true): Promise<boolean> {
    let imported = false;
    const daily = await this.readConfig(`${this.app.vault.configDir}/daily-notes.json`);
    if (daily) {
      const folder = daily["folder"];
      const format = daily["format"];
      const template = daily["template"];
      if (typeof folder === "string") this.settings.dailyFolder = folder;
      if (typeof format === "string" && format) this.settings.dateFormat = format;
      if (typeof template === "string") this.settings.defaultTemplate = template;
      imported = true;
    }
    const reminderData = await this.readConfig(`${this.app.vault.configDir}/plugins/obsidian-reminder-plugin/data.json`);
    const reminderSettings = isRecord(reminderData?.["settings"]) ? reminderData["settings"] : null;
    if (reminderSettings) {
      const time = reminderSettings["reminderTime"];
      const interval = reminderSettings["reminderCheckIntervalSec"];
      const linkDates = reminderSettings["linkDatesToDailyNotes"];
      const laters = reminderSettings["laters"];
      if (typeof time === "string" && /^\d{1,2}:\d{2}$/.test(time)) this.settings.defaultReminderTime = time;
      if (typeof interval === "number") this.settings.reminderIntervalSeconds = Math.max(15, interval);
      if (typeof linkDates === "boolean") this.settings.linkReminderDates = linkDates;
      if (typeof laters === "string") {
        const minutes = laters.split("\n").map(parseSnooze).filter((value): value is number => value !== null);
        if (minutes.length) this.settings.snoozeMinutes = minutes;
      }
      imported = true;
    }
    if (imported) await this.saveSettings();
    if (showNotice) new Notice(imported
      ? "ProdLife imported your Daily Notes and Reminder settings. Review them before disabling the old plugins."
      : "ProdLife could not find Daily Notes or Reminder settings to import.");
    return imported;
  }

  async addTemplateTask(target: string, title: string, time: string, allDay: boolean): Promise<boolean> {
    const path = target === "default" ? this.settings.defaultTemplate : this.settings.weekdayTemplates[target] || this.settings.defaultTemplate;
    if (!path) {
      new Notice("Choose a daily note template before adding a template task.");
      return false;
    }
    return this.daily.addTaskToTemplate(path, title, time, allDay);
  }

  async openDashboardCustomizer(): Promise<void> {
    openDashboardLayout(this.app, this.settings, async () => { await this.saveSettings(); await this.refreshViews(); });
  }

  private async persistData(): Promise<void> {
    await this.saveData(this.data);
  }

  private async readConfig(path: string): Promise<Record<string, unknown> | null> {
    const normalized = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalized))) return null;
    try {
      const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(normalized)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch (error) {
      console.warn(`ProdLife could not read ${normalized}`, error);
      return null;
    }
  }

  private async activateDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof DashboardView) await view.render();
  }

  private async activateReminders(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(REMINDER_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: REMINDER_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof ReminderListView) await leaf.view.render();
  }

  private onVaultChange(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    this.reminders.invalidate();
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) {
        if (leaf.view instanceof DashboardView) void leaf.view.render();
      }
      for (const leaf of this.app.workspace.getLeavesOfType(REMINDER_VIEW)) {
        if (leaf.view instanceof ReminderListView) void leaf.view.render();
      }
    }, 500);
  }

  private petCheckIn(automatic = false): void {
    if (automatic && !this.settings.petEnabled) return;
    const quotes = this.settings.quotes;
    const message = quotes[Math.floor(Math.random() * quotes.length)] ?? "Pick one small thing and begin.";
    this.showPet(message);
  }

  private showPet(message: string): void {
    this.dismissPet();
    const popup = this.app.workspace.containerEl.doc.body.createDiv({ cls: "prodlife-pet-popup", attr: { role: "status", "aria-live": "polite" } });
    popup.createDiv({ cls: "prodlife-pip-sprite prodlife-pip-sprite--talk" });
    const bubble = popup.createDiv({ cls: "prodlife-pet-speech" });
    bubble.createEl("strong", { text: this.settings.petName });
    bubble.createEl("p", { text: message });
    const close = bubble.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Dismiss ${this.settings.petName}` } });
    close.setText("×");
    close.addEventListener("click", () => this.dismissPet());
    this.petPopup = popup;
    window.requestAnimationFrame(() => popup.addClass("is-visible"));
    this.petTimer = window.setTimeout(() => this.dismissPet(), 12_000);
  }

  private dismissPet(): void {
    if (this.petTimer !== null) window.clearTimeout(this.petTimer);
    this.petTimer = null;
    this.petPopup?.removeClass("is-visible");
    const popup = this.petPopup;
    this.petPopup = null;
    if (popup) window.setTimeout(() => popup.remove(), 180);
  }

  private async refreshViews(): Promise<void> {
    const renders: Promise<void>[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) if (leaf.view instanceof DashboardView) renders.push(leaf.view.render());
    for (const leaf of this.app.workspace.getLeavesOfType(REMINDER_VIEW)) if (leaf.view instanceof ReminderListView) renders.push(leaf.view.render());
    await Promise.all(renders);
  }

  private async recordAchievements(achievements: Achievement[]): Promise<void> {
    const unlocked = achievements.filter((achievement) => achievement.unlocked && !this.data.achievementUnlocks[achievement.id]);
    if (!this.data.achievementsInitialized) {
      for (const achievement of unlocked) this.data.achievementUnlocks[achievement.id] = Date.now();
      this.data.achievementsInitialized = true;
      await this.persistData();
      return;
    }
    if (!unlocked.length) return;
    for (const achievement of unlocked) {
      this.data.achievementUnlocks[achievement.id] = Date.now();
      achievement.unlockedAt = this.data.achievementUnlocks[achievement.id];
      this.achievementQueue.push(achievement);
    }
    await this.persistData();
    this.showNextAchievement();
  }

  private showNextAchievement(): void {
    if (this.achievementShowing) return;
    const achievement = this.achievementQueue.shift();
    if (!achievement) return;
    this.achievementShowing = true;
    new AchievementUnlockModal(this.app, achievement, this.settings.petName, () => {
      this.achievementShowing = false;
      this.showNextAchievement();
    }).open();
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseSnooze(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "tomorrow") return 1440;
  if (normalized === "next week") return 10080;
  const match = normalized.match(/(?:in\s+)?(\d+)\s*(minute|minutes|hour|hours|day|days)/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? "minutes";
  return amount * (unit.startsWith("hour") ? 60 : unit.startsWith("day") ? 1440 : 1);
}
