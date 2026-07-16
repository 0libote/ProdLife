import { Modal, Notice, Plugin, Setting, TAbstractFile, TFile, normalizePath } from "obsidian";
import { DailyNotesService } from "./daily-notes";
import { AchievementUnlockModal, DASHBOARD_VIEW, DashboardView, openDashboardLayout } from "./dashboard";
import { REMINDER_VIEW, ReminderListView } from "./reminder-view";
import { ReminderService } from "./reminders";
import { ProdLifeSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type Achievement, type ProdLifeData, type ProdLifeSettings } from "./types";
import { mergeWritingHistory, normalizeWritingHistory, WritingTracker } from "./writing";

const DATA_SCHEMA_VERSION = 3;

export default class ProdLifePlugin extends Plugin {
  settings: ProdLifeSettings = { ...DEFAULT_SETTINGS };
  private data: ProdLifeData = {
    schemaVersion: DATA_SCHEMA_VERSION,
    settings: this.settings,
    snoozedUntil: {},
    notified: {},
    completedReminders: {},
    writingHistory: {},
    writingFiles: {},
    writingInitialized: false,
    writingMetricsInitialized: false,
    achievementUnlocks: {},
    achievementsInitialized: false,
    setupComplete: false
  };
  private daily!: DailyNotesService;
  private reminders!: ReminderService;
  private writing!: WritingTracker;
  private renderTimer: number | null = null;
  private achievementQueue: Achievement[] = [];
  private achievementShowing = false;
  private petPopup: HTMLElement | null = null;
  private petTimer: number | null = null;
  private petQuietUntil = 0;
  private saveChain: Promise<void> = Promise.resolve();
  private deviceId = "";

  async onload(): Promise<void> {
    await this.loadSettings();
    const savedDeviceId: unknown = this.app.loadLocalStorage("prodlife-device-id");
    this.deviceId = typeof savedDeviceId === "string" && savedDeviceId ? savedDeviceId : crypto.randomUUID();
    this.app.saveLocalStorage("prodlife-device-id", this.deviceId);
    this.daily = new DailyNotesService(this.app, () => this.settings);
    this.reminders = new ReminderService(this.app, () => this.settings, () => this.data, () => this.persistData(), this, (date) => this.daily.linkFor(date));
    this.writing = new WritingTracker(this.app, () => this.settings, () => this.data, () => this.persistData(), (file) => {
      const frontmatterDate: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.date;
      return typeof frontmatterDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(frontmatterDate) ? frontmatterDate : this.daily.dateFor(file);
    }, () => this.scheduleRefresh(650), this.deviceId);
    this.reminders.delayUntil(Date.now() + this.settings.startupDelaySeconds * 1000);

    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this.daily, this.reminders, this.writing, () => this.settings, () => this.data, () => this.saveSettings(), (achievements) => this.recordAchievements(achievements), () => this.petCheckIn()));
    this.registerView(REMINDER_VIEW, (leaf) => new ReminderListView(leaf, this.reminders));
    this.addSettingTab(new ProdLifeSettingTab(this.app, this));

    this.addRibbonIcon("calendar-check", "Open today's ProdLife note", () => void this.daily.open());
    this.addRibbonIcon("sprout", "Open ProdLife dashboard", () => void this.activateDashboard());
    this.addRibbonIcon("alarm-clock", "Open ProdLife reminders", () => void this.activateReminders());
    this.addCommand({ id: "open-today", name: "Open today's note", callback: () => void this.daily.open() });
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.activateDashboard() });
    this.addCommand({ id: "open-reminders", name: "Open reminder sidebar", callback: () => void this.activateReminders() });
    this.addCommand({ id: "open-setup-guide", name: "Open setup guide", callback: () => this.openSetupGuide() });
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

    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultChange(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.onVaultChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => { if (file instanceof TFile) this.writing.remove(file.path); this.onVaultChange(file); }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.reminders.invalidate(oldPath);
      if (file instanceof TFile) this.writing.rename(file, oldPath);
      this.onVaultChange(file);
    }));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      menu.addItem((item) => item.setTitle("Set ProdLife reminder").setIcon("alarm-clock-plus").onClick(() => this.reminders.editCurrentLine(editor)));
    }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file) void this.app.vault.cachedRead(file).then((content) => this.writing.observe(file, content));
    }));
    this.registerEvent(this.app.workspace.on("editor-change", (editor, info) => {
      if (info.file) this.writing.schedule(info.file, editor.getValue());
    }));
    this.registerInterval(window.setInterval(() => void this.reminders.checkDue(), Math.max(15, this.settings.reminderIntervalSeconds) * 1000));
    this.registerInterval(window.setInterval(() => this.petCheckIn(true), Math.max(30, this.settings.petCheckInMinutes) * 60_000));
    this.app.workspace.onLayoutReady(() => {
      if (!this.data.setupComplete) this.openSetupGuide();
      window.setTimeout(() => {
        void this.writing.initialize().then(async () => {
          const active = this.app.workspace.getActiveFile();
          if (active) this.writing.observe(active, await this.app.vault.cachedRead(active));
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
    this.settings = normalizeSettings(stored?.settings);
    if (this.settings.autoArchiveMode !== "off" && !this.settings.archiveFolder.trim()) this.settings.archiveFolder = "Archive/Daily";
    this.data = {
      schemaVersion: DATA_SCHEMA_VERSION,
      settings: this.settings,
      snoozedUntil: stored?.snoozedUntil ?? {},
      notified: stored?.notified ?? {},
      completedReminders: stored?.completedReminders ?? {},
      writingHistory: normalizeWritingHistory(stored?.writingHistory ?? {}),
      writingFiles: stored?.writingFiles ?? {},
      writingInitialized: stored?.writingInitialized ?? false,
      writingMetricsInitialized: stored?.writingMetricsInitialized ?? false,
      achievementUnlocks: stored?.achievementUnlocks ?? {},
      achievementsInitialized: stored?.achievementsInitialized ?? false,
      setupComplete: stored?.setupComplete ?? hasStoredSettings
    };
    if (!hasStoredSettings) await this.importLegacySettings(false);
  }

  async saveSettings(invalidateReminders = false): Promise<void> {
    this.data.settings = this.settings;
    if (invalidateReminders) this.reminders?.invalidate();
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
    if (imported) await this.saveSettings(true);
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

  openSetupGuide(): void {
    new ProdLifeWelcomeModal(this.app, this).open();
  }

  async completeSetup(useRecommended: boolean): Promise<void> {
    if (useRecommended) {
      this.settings.dailyFolder = "Daily";
      this.settings.dateFormat = "YYYY-MM-DD";
      this.settings.archiveFolder = "Archive/Daily";
      this.settings.autoArchiveMode = "next-day";
      this.settings.remindersEnabled = true;
      this.settings.petEnabled = true;
    }
    this.data.setupComplete = true;
    await this.saveSettings();
    new Notice("ProdLife is ready. Open today’s note or the dashboard whenever you like.");
  }

  private async persistData(): Promise<void> {
    const snapshot = structuredClone(this.data);
    this.saveChain = this.saveChain.catch((error: unknown) => {
      console.error("ProdLife could not save plugin data", error);
    }).then(() => this.saveData(snapshot));
    await this.saveChain;
  }

  async onExternalSettingsChange(): Promise<void> {
    const stored = (await this.loadData()) as Partial<ProdLifeData> | null;
    if (!stored) return;
    this.settings = normalizeSettings(stored.settings);
    if (this.settings.autoArchiveMode !== "off" && !this.settings.archiveFolder.trim()) this.settings.archiveFolder = "Archive/Daily";
    this.data.settings = this.settings;
    this.data.snoozedUntil = mergeLatest(this.data.snoozedUntil, stored.snoozedUntil ?? {});
    this.data.notified = mergeLatest(this.data.notified, stored.notified ?? {});
    this.data.completedReminders = mergeLatest(this.data.completedReminders, stored.completedReminders ?? {});
    this.data.writingHistory = mergeWritingHistory(this.data.writingHistory, stored.writingHistory ?? {});
    this.data.writingFiles = { ...stored.writingFiles, ...this.data.writingFiles };
    this.data.writingInitialized ||= stored.writingInitialized ?? false;
    this.data.writingMetricsInitialized ||= stored.writingMetricsInitialized ?? false;
    this.data.achievementUnlocks = mergeEarliest(this.data.achievementUnlocks, stored.achievementUnlocks ?? {});
    this.data.achievementsInitialized ||= stored.achievementsInitialized ?? false;
    this.data.setupComplete ||= stored.setupComplete ?? false;
    this.reminders.invalidate();
    await this.persistData();
    await this.refreshViews();
  }

  onunload(): void {
    void this.writing?.flush();
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
    this.reminders.invalidate(file.path);
    this.scheduleRefresh();
  }

  private scheduleRefresh(delay = 500): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.refreshViews();
    }, delay);
  }

  private petCheckIn(automatic = false): void {
    if (automatic && (!this.settings.petEnabled || Date.now() < this.petQuietUntil || !document.hasFocus() || document.querySelector(".modal-container"))) return;
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
    const actions = bubble.createDiv({ cls: "prodlife-pet-actions" });
    actions.createEl("button", { text: "Thanks" }).addEventListener("click", () => this.dismissPet());
    actions.createEl("button", { text: "Quiet today" }).addEventListener("click", () => {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      this.petQuietUntil = tomorrow.getTime();
      this.dismissPet();
    });
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

function normalizeSettings(stored?: Partial<ProdLifeSettings>): ProdLifeSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    weekdayTemplates: { ...DEFAULT_SETTINGS.weekdayTemplates, ...(stored?.weekdayTemplates ?? {}) },
    reminderFolders: stored?.reminderFolders?.filter((path): path is string => typeof path === "string") ?? DEFAULT_SETTINGS.reminderFolders,
    snoozeMinutes: stored?.snoozeMinutes?.filter((minutes): minutes is number => typeof minutes === "number" && minutes > 0) ?? DEFAULT_SETTINGS.snoozeMinutes,
    dashboardSections: stored?.dashboardSections?.filter((section): section is ProdLifeSettings["dashboardSections"][number] => ["hero", "metrics", "heatmap", "achievements", "reminders"].includes(section)) ?? DEFAULT_SETTINGS.dashboardSections,
    heatmapMetric: ["words", "characters", "lines"].includes(stored?.heatmapMetric ?? "") ? stored!.heatmapMetric! : DEFAULT_SETTINGS.heatmapMetric,
    writingFolders: stored?.writingFolders?.filter((path): path is string => typeof path === "string") ?? DEFAULT_SETTINGS.writingFolders,
    quotes: stored?.quotes?.length ? stored.quotes : DEFAULT_SETTINGS.quotes
  };
}

function mergeLatest(local: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  const merged = { ...local };
  for (const [key, value] of Object.entries(incoming)) merged[key] = Math.max(merged[key] ?? 0, value);
  return merged;
}

function mergeEarliest(local: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  const merged = { ...local };
  for (const [key, value] of Object.entries(incoming)) merged[key] = merged[key] ? Math.min(merged[key], value) : value;
  return merged;
}

class ProdLifeWelcomeModal extends Modal {
  constructor(app: ProdLifePlugin["app"], private plugin: ProdLifePlugin) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("prodlife-welcome-modal");
    this.contentEl.createDiv({ cls: "prodlife-pip-sprite" });
    this.contentEl.createEl("p", { cls: "prodlife-eyebrow", text: "Meet Pip" });
    this.contentEl.createEl("h2", { text: "A calmer way to run your day" });
    this.contentEl.createEl("p", { text: "ProdLife creates daily notes, rolls unfinished tasks forward, surfaces reminders, and records writing activity permanently—even after a source note is deleted." });
    const list = this.contentEl.createEl("ul");
    list.createEl("li", { text: "Your notes remain ordinary Markdown files." });
    list.createEl("li", { text: "Obsidian Sync carries settings and history between devices." });
    list.createEl("li", { text: "Completed reminders are remembered across devices to prevent repeat alerts." });
    new Setting(this.contentEl)
      .setName("Recommended setup")
      .setDesc("Daily notes in Daily, archived next day to Archive/Daily, ISO dates, reminders on, and Pip enabled.")
      .addButton((button) => button.setCta().setButtonText("Use recommended").onClick(() => {
        void this.plugin.completeSetup(true).then(() => this.close());
      }));
    new Setting(this.contentEl)
      .setName("Keep current setup")
      .setDesc("Use imported or existing folder, template, and reminder choices exactly as shown in settings.")
      .addButton((button) => button.setButtonText("Keep mine").onClick(() => {
        void this.plugin.completeSetup(false).then(() => this.close());
      }));
  }
}
