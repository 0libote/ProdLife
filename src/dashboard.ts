import { App, ItemView, Modal, Setting, WorkspaceLeaf, setIcon } from "obsidian";
import { achievementsFor, activityFromContent, calculateStreak, isoDate, streakForValues } from "./core";
import type { DailyNotesService } from "./daily-notes";
import { renderReminderMarkdown } from "./reminder-view";
import type { ReminderService } from "./reminders";
import type { Achievement, DashboardSectionId, DayActivity, ProdLifeData, ProdLifeSettings } from "./types";
import type { WritingTracker } from "./writing";

export const DASHBOARD_VIEW = "prodlife-dashboard";
const ALL_SECTIONS: Array<{ id: DashboardSectionId; label: string }> = [
  { id: "hero", label: "Daily focus" },
  { id: "metrics", label: "Metrics" },
  { id: "heatmap", label: "Writing heatmap" },
  { id: "achievements", label: "Achievements" },
  { id: "reminders", label: "Upcoming reminders" }
];

export class DashboardView extends ItemView {
  private heatmapMode: "year" | "month";
  private heatmapCursor = new Date();

  constructor(
    leaf: WorkspaceLeaf,
    private daily: DailyNotesService,
    private reminders: ReminderService,
    private writing: WritingTracker,
    private settings: () => ProdLifeSettings,
    private data: () => ProdLifeData,
    private saveSettings: () => Promise<void>,
    private recordAchievements: (achievements: Achievement[]) => Promise<void>
  ) {
    super(leaf);
    this.heatmapMode = settings().heatmapMode;
  }

  getViewType(): string { return DASHBOARD_VIEW; }
  getDisplayText(): string { return "ProdLife"; }
  getIcon(): string { return "sprout"; }
  async onOpen(): Promise<void> { await this.render(); }

  async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("prodlife-dashboard");
    const masthead = root.createEl("header", { cls: "prodlife-masthead" });
    masthead.createEl("h1", { cls: "prodlife-wordmark", text: "ProdLife" });
    const customize = masthead.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Customize dashboard" } });
    setIcon(customize, "panels-top-left");
    customize.addEventListener("click", () => openDashboardLayout(this.app, this.settings(), async () => { await this.saveSettings(); await this.render(); }));

    const activity = await this.loadActivity(this.app);
    const writing = this.writing.values();
    const today = new Date();
    const taskStreak = calculateStreak(activity, today);
    let achievements = achievementsFor(activity, taskStreak, writing, this.data().achievementUnlocks);
    await this.recordAchievements(achievements);
    achievements = achievementsFor(activity, taskStreak, writing, this.data().achievementUnlocks);

    for (const section of this.settings().dashboardSections) {
      if (section === "hero") this.renderHero(root, taskStreak, activity, today);
      else if (section === "metrics") this.renderMetrics(root, activity, writing, taskStreak, today);
      else if (section === "heatmap") this.renderHeatmapSection(root, writing);
      else if (section === "achievements") this.renderAchievementSummary(root, achievements);
      else if (section === "reminders") await this.renderReminders(root);
    }
  }

  private renderHero(root: HTMLElement, taskStreak: number, activity: DayActivity[], today: Date): void {
    const todayActivity = activity.find((day) => day.date === isoDate(today));
    const hero = root.createEl("section", { cls: "prodlife-hero" });
    const greeting = hero.createDiv({ cls: "prodlife-hero-copy" });
    greeting.createEl("p", { cls: "prodlife-eyebrow", text: new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(today) });
    greeting.createEl("h2", { text: taskStreak ? `${taskStreak} days of momentum.` : "Make today count." });
    greeting.createEl("p", { text: todayActivity?.completed ? `${todayActivity.completed} task${todayActivity.completed === 1 ? "" : "s"} completed today.` : "One completed task is enough to begin a streak." });
    const openToday = greeting.createEl("button", { cls: "mod-cta", text: "Open today's note" });
    openToday.addEventListener("click", () => void this.daily.open());
    const pet = hero.createDiv({ cls: "prodlife-pet-card" });
    pet.createDiv({ cls: "prodlife-pip-sprite", attr: { role: "img", "aria-label": `${this.settings().petName}, your productivity pet` } });
    pet.createEl("strong", { text: this.settings().petName });
    pet.createSpan({ text: petMessage(taskStreak, todayActivity?.completed ?? 0) });
  }

  private renderMetrics(root: HTMLElement, activity: DayActivity[], writing: Record<string, number>, taskStreak: number, today: Date): void {
    const metrics = root.createEl("section", { cls: "prodlife-metrics", attr: { "aria-label": "Productivity metrics" } });
    metric(metrics, "flame", String(taskStreak), "task streak");
    metric(metrics, "pen-line", (writing[isoDate(today)] ?? 0).toLocaleString(), "words today");
    metric(metrics, "circle-check-big", activity.reduce((sum, day) => sum + day.completed, 0).toLocaleString(), "tasks completed");
    metric(metrics, "feather", streakForValues(writing, today).toLocaleString(), "writing streak");
  }

  private renderHeatmapSection(root: HTMLElement, writing: Record<string, number>): void {
    const section = root.createEl("section", { cls: "prodlife-panel prodlife-progress" });
    const header = section.createDiv({ cls: "prodlife-section-header" });
    const copy = header.createDiv();
    copy.createEl("h3", { text: "Writing rhythm" });
    copy.createEl("p", { text: `${Object.values(writing).reduce((sum, words) => sum + words, 0).toLocaleString()} words permanently logged` });
    const controls = header.createDiv({ cls: "prodlife-heatmap-controls" });
    const mode = controls.createEl("select", { attr: { "aria-label": "Heatmap range" } });
    mode.createEl("option", { text: "Year", value: "year" });
    mode.createEl("option", { text: "Month", value: "month" });
    mode.value = this.heatmapMode;
    mode.addEventListener("change", () => {
      this.heatmapMode = mode.value === "month" ? "month" : "year";
      this.settings().heatmapMode = this.heatmapMode;
      void this.saveSettings().then(() => this.render());
    });
    const previous = controls.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Previous ${this.heatmapMode}` } });
    setIcon(previous, "chevron-left");
    previous.addEventListener("click", () => { this.moveHeatmap(-1); void this.render(); });
    controls.createEl("strong", { cls: "prodlife-heatmap-period", text: this.heatmapMode === "year" ? String(this.heatmapCursor.getFullYear()) : new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(this.heatmapCursor) });
    const next = controls.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Next ${this.heatmapMode}` } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => { this.moveHeatmap(1); void this.render(); });
    renderWordHeatmap(section, writing, this.settings().writingGoal, this.heatmapMode, this.heatmapCursor);
  }

  private renderAchievementSummary(root: HTMLElement, achievements: Achievement[]): void {
    const unlocked = achievements.filter((achievement) => achievement.unlocked).length;
    const button = root.createEl("button", { cls: "prodlife-achievement-summary" });
    const icon = button.createDiv({ cls: "prodlife-achievement-summary-icon" });
    setIcon(icon, "trophy");
    const copy = button.createDiv();
    copy.createEl("strong", { text: `${unlocked}/${achievements.length} achievements` });
    copy.createSpan({ text: unlocked === achievements.length ? "Every milestone unlocked" : "Open the collection and see what is next" });
    const arrow = button.createDiv({ cls: "prodlife-achievement-summary-arrow" });
    setIcon(arrow, "arrow-up-right");
    button.addEventListener("click", () => new AchievementModal(this.app, achievements).open());
  }

  private async renderReminders(root: HTMLElement): Promise<void> {
    const reminderPanel = root.createEl("section", { cls: "prodlife-panel prodlife-reminders" });
    const reminderHeader = reminderPanel.createDiv({ cls: "prodlife-section-header" });
    reminderHeader.createEl("h3", { text: "Up next" });
    const refresh = reminderHeader.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh reminders" } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => { this.reminders.invalidate(); void this.render(); });
    const reminders = (await this.reminders.scan()).filter((item) => !item.completed).slice(0, 8);
    if (!reminders.length) reminderPanel.createEl("p", { cls: "prodlife-empty", text: "No upcoming reminders. Your horizon is clear." });
    for (const item of reminders) {
      const row = reminderPanel.createDiv({ cls: `prodlife-reminder-row${item.due < Date.now() ? " is-overdue" : ""}` });
      const complete = row.createEl("button", { cls: "prodlife-task-check", attr: { "aria-label": `Complete ${item.text}` } });
      complete.addEventListener("click", () => { void this.reminders.complete(item).then(() => this.render()); });
      const copy = row.createDiv({ cls: "prodlife-reminder-copy" });
      const title = copy.createEl("button");
      await renderReminderMarkdown(this, item, title);
      title.addEventListener("click", () => void this.reminders.open(item));
      copy.createSpan({ text: `${item.allDay ? "All day" : new Date(item.due).toLocaleString()} · ${item.path}` });
    }
  }

  private moveHeatmap(amount: number): void {
    if (this.heatmapMode === "year") this.heatmapCursor.setFullYear(this.heatmapCursor.getFullYear() + amount);
    else this.heatmapCursor.setMonth(this.heatmapCursor.getMonth() + amount);
  }

  private async loadActivity(app: App): Promise<DayActivity[]> {
    const activity: DayActivity[] = [];
    for (const file of this.daily.trackedFiles()) {
      const cache = app.metadataCache.getFileCache(file);
      const prodLifeDate = cache?.frontmatter?.prodlife === true && typeof cache.frontmatter.date === "string" ? cache.frontmatter.date : null;
      const date = prodLifeDate ?? this.daily.dateFor(file);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      activity.push(activityFromContent(date, await app.vault.cachedRead(file)));
    }
    return activity;
  }
}

export function openDashboardLayout(app: App, settings: ProdLifeSettings, save: () => Promise<void>): void {
  new DashboardLayoutModal(app, settings, save).open();
}

export class AchievementUnlockModal extends Modal {
  constructor(app: App, private achievement: Achievement, private petName: string, private closed?: () => void) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("prodlife-unlock-modal");
    this.contentEl.createDiv({ cls: "prodlife-pip-sprite prodlife-pip-sprite--celebrate" });
    this.contentEl.createEl("p", { cls: "prodlife-eyebrow", text: `${this.petName} found something` });
    this.contentEl.createEl("h2", { text: "Achievement unlocked" });
    const badge = this.contentEl.createDiv({ cls: "prodlife-unlock-badge" });
    setIcon(badge, this.achievement.icon);
    this.contentEl.createEl("h3", { text: this.achievement.name });
    this.contentEl.createEl("p", { text: this.achievement.description });
    new Setting(this.contentEl).addButton((button) => button.setCta().setButtonText("Nice").onClick(() => this.close()));
  }
  onClose(): void { this.closed?.(); }
}

class DashboardLayoutModal extends Modal {
  constructor(app: App, private settings: ProdLifeSettings, private save: () => Promise<void>) { super(app); }
  onOpen(): void { this.render(); }
  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Customize dashboard" });
    this.contentEl.createEl("p", { text: "Show only what helps, then move sections into your preferred order." });
    for (const section of ALL_SECTIONS) {
      const index = this.settings.dashboardSections.indexOf(section.id);
      new Setting(this.contentEl)
        .setName(section.label)
        .addToggle((toggle) => toggle.setValue(index !== -1).onChange((visible) => {
          if (visible && index === -1) this.settings.dashboardSections.push(section.id);
          else if (!visible && index !== -1) this.settings.dashboardSections.splice(index, 1);
          void this.save().then(() => this.render());
        }))
        .addExtraButton((button) => button.setIcon("chevron-up").setTooltip("Move up").setDisabled(index <= 0).onClick(() => this.move(index, -1)))
        .addExtraButton((button) => button.setIcon("chevron-down").setTooltip("Move down").setDisabled(index === -1 || index === this.settings.dashboardSections.length - 1).onClick(() => this.move(index, 1)));
    }
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Reset layout").onClick(() => {
      this.settings.dashboardSections = ALL_SECTIONS.map((section) => section.id);
      void this.save().then(() => this.render());
    }));
  }
  private move(index: number, direction: number): void {
    const next = index + direction;
    const current = this.settings.dashboardSections[index];
    if (current === undefined || next < 0 || next >= this.settings.dashboardSections.length) return;
    this.settings.dashboardSections.splice(index, 1);
    this.settings.dashboardSections.splice(next, 0, current);
    void this.save().then(() => this.render());
  }
}

class AchievementModal extends Modal {
  constructor(app: App, private achievements: Achievement[]) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("prodlife-achievement-modal");
    const unlocked = this.achievements.filter((achievement) => achievement.unlocked).length;
    this.contentEl.createEl("h2", { text: `Achievements · ${unlocked}/${this.achievements.length}` });
    for (const category of ["tasks", "writing", "streaks", "consistency"] as const) {
      this.contentEl.createEl("h3", { text: { tasks: "Tasks", writing: "Writing", streaks: "Streaks", consistency: "Consistency" }[category] });
      const grid = this.contentEl.createDiv({ cls: "prodlife-achievement-grid" });
      for (const achievement of this.achievements.filter((item) => item.category === category)) {
        const card = grid.createDiv({ cls: `prodlife-achievement-card${achievement.unlocked ? " is-unlocked" : ""}` });
        const icon = card.createDiv({ cls: "prodlife-achievement-icon" });
        setIcon(icon, achievement.unlocked ? achievement.icon : "lock-keyhole");
        card.createEl("strong", { text: achievement.name });
        card.createSpan({ text: achievement.description });
        const progress = card.createEl("progress", { attr: { max: String(achievement.target), value: String(achievement.progress) } });
        card.createEl("small", { text: achievement.unlockedAt ? `Unlocked ${new Date(achievement.unlockedAt).toLocaleDateString()}` : `${achievement.progress.toLocaleString()} / ${achievement.target.toLocaleString()}` });
        progress.value = achievement.progress;
      }
    }
  }
}

function metric(parent: HTMLElement, iconName: string, value: string, label: string): void {
  const item = parent.createDiv({ cls: "prodlife-metric" });
  const icon = item.createDiv({ cls: "prodlife-metric-icon" });
  setIcon(icon, iconName);
  const copy = item.createDiv();
  copy.createEl("strong", { text: value });
  copy.createSpan({ text: label });
}

function renderWordHeatmap(parent: HTMLElement, values: Record<string, number>, goal: number, mode: "year" | "month", cursor: Date): void {
  const wrapper = parent.createDiv({ cls: `prodlife-heatmap prodlife-heatmap--${mode}`, attr: { role: "grid", "aria-label": `Word count heatmap for ${mode === "year" ? cursor.getFullYear() : cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}` } });
  if (mode === "month") for (const day of ["M", "T", "W", "T", "F", "S", "S"]) wrapper.createSpan({ cls: "prodlife-calendar-weekday", text: day });
  const start = mode === "year" ? new Date(cursor.getFullYear(), 0, 1) : new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = mode === "year" ? new Date(cursor.getFullYear(), 11, 31) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const offset = mode === "year" ? start.getDay() : (start.getDay() + 6) % 7;
  for (let blank = 0; blank < offset; blank++) wrapper.createSpan({ cls: "prodlife-heatmap-blank" });
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const words = values[isoDate(date)] ?? 0;
    const level = Math.min(4, Math.ceil(words / Math.max(1, goal / 4)));
    wrapper.createEl("button", {
      cls: `prodlife-heatmap-day level-${level}`,
      attr: { title: `${date.toLocaleDateString()}: ${words.toLocaleString()} words`, "aria-label": `${date.toLocaleDateString()}, ${words.toLocaleString()} words`, role: "gridcell" }
    });
  }
  const legend = parent.createDiv({ cls: "prodlife-heatmap-legend" });
  legend.createSpan({ text: "No words" });
  for (let level = 0; level <= 4; level++) legend.createDiv({ cls: `prodlife-heatmap-day level-${level}` });
  legend.createSpan({ text: `${goal.toLocaleString()}+` });
}

function petMessage(streak: number, completed: number): string {
  if (completed >= 5) return "You are flying today. Remember to take a proper break.";
  if (completed > 0) return "I saw that progress. Keep the next step small.";
  if (streak > 0) return "Your streak is safe once you finish one thing today.";
  return "I'll keep you company while you choose the first thing.";
}
