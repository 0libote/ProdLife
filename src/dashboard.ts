import { App, ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { achievementsFor, activityFromContent, calculateStreak } from "./core";
import type { DailyNotesService } from "./daily-notes";
import type { ReminderService } from "./reminders";
import type { DayActivity, ProdLifeSettings } from "./types";

export const DASHBOARD_VIEW = "prodlife-dashboard";

export class DashboardView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private daily: DailyNotesService,
    private reminders: ReminderService,
    private settings: () => ProdLifeSettings
  ) { super(leaf); }

  getViewType(): string { return DASHBOARD_VIEW; }
  getDisplayText(): string { return "ProdLife"; }
  getIcon(): string { return "sprout"; }
  async onOpen(): Promise<void> { await this.render(); }

  async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("prodlife-dashboard");
    root.createEl("h1", { cls: "prodlife-wordmark", text: "ProdLife" });

    const activity = await this.loadActivity(this.app);
    const today = new Date();
    const streak = calculateStreak(activity, today);
    const total = activity.reduce((sum, day) => sum + day.completed, 0);
    const todayKey = iso(today);
    const todayActivity = activity.find((day) => day.date === todayKey);

    const hero = root.createDiv({ cls: "prodlife-hero" });
    const greeting = hero.createDiv({ cls: "prodlife-hero-copy" });
    greeting.createEl("p", { cls: "prodlife-eyebrow", text: new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(today) });
    greeting.createEl("h2", { text: streak ? `${streak} days of momentum.` : "Make today count." });
    greeting.createEl("p", { text: todayActivity?.completed ? `${todayActivity.completed} task${todayActivity.completed === 1 ? "" : "s"} completed today.` : "One completed task is enough to begin a streak." });
    const openToday = greeting.createEl("button", { cls: "mod-cta", text: "Open today's note" });
    openToday.addEventListener("click", () => void this.daily.open());
    const pet = hero.createDiv({ cls: "prodlife-pet-card" });
    pet.createDiv({ cls: streak ? "prodlife-pet prodlife-pet--happy" : "prodlife-pet", text: streak ? "◆" : "◇" });
    pet.createEl("strong", { text: this.settings().petName });
    pet.createSpan({ text: petMessage(streak, todayActivity?.completed ?? 0) });

    const metrics = root.createDiv({ cls: "prodlife-metrics" });
    metric(metrics, "flame", String(streak), "day streak");
    metric(metrics, "circle-check-big", String(total), "tasks completed");
    metric(metrics, "calendar-check", String(activity.filter((day) => day.completed > 0).length), "active days");

    const grid = root.createDiv({ cls: "prodlife-grid" });
    const progress = grid.createDiv({ cls: "prodlife-panel prodlife-progress" });
    progress.createEl("h3", { text: "Your rhythm" });
    progress.createEl("p", { text: "Completed tasks over the last year" });
    renderHeatmap(progress, activity, today);

    const achievements = grid.createDiv({ cls: "prodlife-panel prodlife-achievements" });
    achievements.createEl("h3", { text: "Achievements" });
    for (const achievement of achievementsFor(activity, streak)) {
      const row = achievements.createDiv({ cls: `prodlife-achievement${achievement.unlocked ? " is-unlocked" : ""}` });
      const icon = row.createDiv({ cls: "prodlife-achievement-icon" });
      setIcon(icon, achievement.unlocked ? "award" : "lock-keyhole");
      const copy = row.createDiv();
      copy.createEl("strong", { text: achievement.name });
      copy.createSpan({ text: achievement.description });
    }

    const reminderPanel = root.createDiv({ cls: "prodlife-panel prodlife-reminders" });
    const reminderHeader = reminderPanel.createDiv({ cls: "prodlife-panel-header" });
    reminderHeader.createEl("h3", { text: "Up next" });
    const refresh = reminderHeader.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh reminders" } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.render());
    const reminders = (await this.reminders.scan()).filter((item) => !item.completed).slice(0, 8);
    if (!reminders.length) reminderPanel.createEl("p", { cls: "prodlife-empty", text: "No upcoming reminders. Your horizon is clear." });
    for (const item of reminders) {
      const row = reminderPanel.createDiv({ cls: `prodlife-reminder-row${item.due < Date.now() ? " is-overdue" : ""}` });
      const complete = row.createEl("button", { cls: "prodlife-task-check", attr: { "aria-label": `Complete ${item.text}` } });
      complete.addEventListener("click", () => { void this.reminders.complete(item).then(() => this.render()); });
      const copy = row.createDiv({ cls: "prodlife-reminder-copy" });
      const title = copy.createEl("button", { text: item.text });
      title.addEventListener("click", () => void this.reminders.open(item));
      copy.createSpan({ text: `${new Date(item.due).toLocaleString()} · ${item.path}` });
    }
  }

  private async loadActivity(app: App): Promise<DayActivity[]> {
    const activity: DayActivity[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(file);
      const prodLifeDate = cache?.frontmatter?.prodlife === true && typeof cache.frontmatter.date === "string"
        ? cache.frontmatter.date
        : null;
      const date = prodLifeDate ?? this.daily.dateFor(file);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      activity.push(activityFromContent(date, await app.vault.cachedRead(file)));
    }
    return activity;
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

function renderHeatmap(parent: HTMLElement, activity: DayActivity[], today: Date): void {
  const byDate = new Map(activity.map((day) => [day.date, day]));
  const heatmap = parent.createDiv({ cls: "prodlife-heatmap", attr: { role: "img", "aria-label": "Task completion heatmap for the last year" } });
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364);
  for (let index = 0; index < 365; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const day = byDate.get(iso(date));
    const count = day?.completed ?? 0;
    const level = count === 0 ? 0 : count < 2 ? 1 : count < 4 ? 2 : count < 7 ? 3 : 4;
    heatmap.createDiv({
      cls: `prodlife-heatmap-day level-${level}`,
      attr: { title: `${date.toLocaleDateString()}: ${count} completed`, "aria-hidden": "true" }
    });
  }
  const legend = parent.createDiv({ cls: "prodlife-heatmap-legend" });
  legend.createSpan({ text: "Less" });
  for (let level = 0; level <= 4; level++) legend.createDiv({ cls: `prodlife-heatmap-day level-${level}` });
  legend.createSpan({ text: "More" });
}

const iso = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function petMessage(streak: number, completed: number): string {
  if (completed >= 5) return "You are flying today. Remember to take a proper break.";
  if (completed > 0) return "I saw that progress. Keep the next step small.";
  if (streak > 0) return "Your streak is safe once you finish one thing today.";
  return "I'll keep you company while you choose the first thing.";
}
