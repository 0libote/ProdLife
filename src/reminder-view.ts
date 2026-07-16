import { ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from "obsidian";
import type { ReminderService } from "./reminders";
import type { ReminderItem } from "./types";

export const REMINDER_VIEW = "prodlife-reminders";

export class ReminderListView extends ItemView {
  private renderGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private reminders: ReminderService) { super(leaf); }

  getViewType(): string { return REMINDER_VIEW; }
  getDisplayText(): string { return "ProdLife reminders"; }
  getIcon(): string { return "alarm-clock"; }
  async onOpen(): Promise<void> {
    const updateSize = (): void => this.contentEl.toggleClass("is-compact", this.contentEl.clientWidth <= 230);
    const observer = new ResizeObserver(updateSize);
    observer.observe(this.contentEl);
    this.register(() => observer.disconnect());
    updateSize();
    await this.render();
  }

  async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.contentEl.addClass("prodlife-reminder-sidebar");
    const root = createDiv();
    const header = root.createDiv({ cls: "prodlife-sidebar-header" });
    header.createEl("h4", { text: "Reminders" });
    const refresh = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh reminders" } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => { this.reminders.invalidate(); void this.render(); });

    const items = (await this.reminders.scan()).filter((item) => !item.completed);
    if (!items.length) {
      root.createEl("p", { cls: "prodlife-empty", text: "No reminders" });
      this.commit(root, generation);
      return;
    }
    for (const group of groupReminders(items)) {
      root.createDiv({ cls: `prodlife-reminder-group-title${group.overdue ? " is-overdue" : ""}`, text: group.label });
      for (const item of group.items) await this.renderItem(root, item);
    }
    this.commit(root, generation);
  }

  private async renderItem(root: HTMLElement, item: ReminderItem): Promise<void> {
    const row = root.createEl("button", {
      cls: "prodlife-sidebar-reminder",
      attr: { "aria-label": `${item.text}, ${new Date(item.due).toLocaleString()}` }
    });
    row.addEventListener("click", () => void this.reminders.open(item));
    row.createSpan({ cls: "prodlife-sidebar-time", text: item.allDay ? "All day" : localTime(new Date(item.due)) });
    const copy = row.createDiv({ cls: "prodlife-sidebar-copy" });
    const title = copy.createSpan({ cls: "prodlife-reminder-markdown" });
    await MarkdownRenderer.render(this.app, item.text, title, item.path, this);
    copy.createSpan({ cls: "prodlife-sidebar-file", text: item.path.split("/").pop()?.replace(/\.md$/, "") ?? item.path });
  }

  private commit(root: HTMLElement, generation: number): void {
    if (generation !== this.renderGeneration) return;
    this.contentEl.empty();
    this.contentEl.append(...Array.from(root.childNodes));
  }
}

export async function renderReminderMarkdown(
  component: ItemView,
  item: ReminderItem,
  target: HTMLElement
): Promise<void> {
  target.empty();
  target.addClass("prodlife-reminder-markdown");
  await MarkdownRenderer.render(component.app, item.text, target, item.path, component);
}

function groupReminders(items: ReminderItem[]): Array<{ label: string; overdue: boolean; items: ReminderItem[] }> {
  const today = startOfDay(new Date()).getTime();
  const tomorrow = today + 86_400_000;
  const groups = new Map<string, { label: string; overdue: boolean; items: ReminderItem[] }>();
  for (const item of items) {
    const day = startOfDay(new Date(item.due)).getTime();
    const label = day < today ? "Overdue" : day === today ? "Today" : day === tomorrow ? "Tomorrow" : new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(day);
    const key = day < today ? "overdue" : String(day);
    const group = groups.get(key) ?? { label, overdue: day < today, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const localTime = (date: Date): string => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
