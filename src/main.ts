import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { DailyNotesService } from "./daily-notes";
import { DASHBOARD_VIEW, DashboardView } from "./dashboard";
import { ReminderService } from "./reminders";
import { ProdLifeSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type ProdLifeData, type ProdLifeSettings } from "./types";

export default class ProdLifePlugin extends Plugin {
  settings: ProdLifeSettings = { ...DEFAULT_SETTINGS };
  private data: ProdLifeData = { settings: this.settings, snoozedUntil: {}, notified: {} };
  private daily!: DailyNotesService;
  private reminders!: ReminderService;
  private renderTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.daily = new DailyNotesService(this.app, () => this.settings);
    this.reminders = new ReminderService(this.app, () => this.settings, () => this.data, () => this.persistData());

    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this.daily, this.reminders, () => this.settings));
    this.addSettingTab(new ProdLifeSettingTab(this.app, this));

    this.addRibbonIcon("calendar-check", "Open today's ProdLife note", () => void this.daily.open());
    this.addRibbonIcon("sprout", "Open ProdLife dashboard", () => void this.activateDashboard());
    this.addCommand({ id: "open-today", name: "Open today's note", callback: () => void this.daily.open() });
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.activateDashboard() });
    this.addCommand({ id: "scan-reminders", name: "Scan reminders now", callback: async () => {
      const count = (await this.reminders.scan()).filter((item) => !item.completed).length;
      new Notice(`ProdLife found ${count} open reminder${count === 1 ? "" : "s"}.`);
      await this.reminders.checkDue();
    }});
    this.addCommand({ id: "archive-old-notes", name: "Archive old daily notes", callback: () => void this.daily.archiveOldNotes() });
    this.addCommand({ id: "pet-check-in", name: "Ask your productivity pet", callback: () => this.petCheckIn() });

    const status = this.addStatusBarItem();
    status.addClass("prodlife-status-pet");
    status.setText(`◆ ${this.settings.petName}`);
    status.setAttr("aria-label", `Ask ${this.settings.petName} for a check-in`);
    status.addEventListener("click", () => this.petCheckIn());

    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultChange(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.onVaultChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onVaultChange(file)));
    this.registerInterval(window.setInterval(() => void this.reminders.checkDue(), Math.max(15, this.settings.reminderIntervalSeconds) * 1000));
    this.registerInterval(window.setInterval(() => this.petCheckIn(true), Math.max(30, this.settings.petCheckInMinutes) * 60_000));
    this.app.workspace.onLayoutReady(() => void this.reminders.checkDue());
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<ProdLifeData> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(stored?.settings ?? {}),
      weekdayTemplates: { ...DEFAULT_SETTINGS.weekdayTemplates, ...(stored?.settings?.weekdayTemplates ?? {}) },
      quotes: stored?.settings?.quotes?.length ? stored.settings.quotes : DEFAULT_SETTINGS.quotes
    };
    this.data = {
      settings: this.settings,
      snoozedUntil: stored?.snoozedUntil ?? {},
      notified: stored?.notified ?? {}
    };
  }

  async saveSettings(): Promise<void> {
    this.data.settings = this.settings;
    this.reminders?.invalidate();
    await this.persistData();
  }

  private async persistData(): Promise<void> {
    await this.saveData(this.data);
  }

  private async activateDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof DashboardView) await view.render();
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
    }, 500);
  }

  private petCheckIn(automatic = false): void {
    if (automatic && !this.settings.petEnabled) return;
    const quotes = this.settings.quotes;
    const message = quotes[Math.floor(Math.random() * quotes.length)] ?? "Pick one small thing and begin.";
    new Notice(`◆ ${this.settings.petName}: ${message}`, 8000);
  }
}
