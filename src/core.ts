import type { Achievement, DayActivity, ReminderItem } from "./types";

const TASK = /^(\s*)[-*+]\s+\[([^\]])\]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+\S/;
const SCHEDULE = /^\s*{{\s*(?:schedule|obligate)\s+([\d,*-]+)\s+([\d,*-]+)\s+([\d,*-]+)\s*}}\s*$/i;

export function parseLocalDate(value: string, defaultTime = "09:00"): number | null {
  const clean = value.replace(/\[\[|\]\]/g, "").trim();
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):?(\d{2})?)?$/);
  if (!match) return null;
  const fallback = defaultTime.match(/^(\d{1,2}):(\d{2})$/);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4] ?? fallback?.[1] ?? 9);
  const minute = Number(match[5] ?? fallback?.[2] ?? 0);
  const date = new Date(year, month, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day || hour > 23 || minute > 59) return null;
  return date.getTime();
}

export function parseReminders(content: string, path: string, defaultTime = "09:00"): ReminderItem[] {
  const reminders: ReminderItem[] = [];
  content.split("\n").forEach((line, index) => {
    const task = line.match(TASK);
    if (!task) return;
    const body = task[3] ?? "";
    const raw = body.match(/\(@([^\)]+)\)/)?.[1]
      ?? body.match(/@\{([^}]+)\}/)?.[1]
      ?? body.match(/⏰\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:?\d{0,2})?)/)?.[1]
      ?? body.match(/[📅📆🗓]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!raw) return;
    const due = parseLocalDate(raw, defaultTime);
    if (due === null) return;
    const text = body
      .replace(/\(@[^\)]+\)|@\{[^}]+\}|[⏰📅📆🗓]\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:?\d{0,2})?/, "")
      .trim();
    reminders.push({
      id: `${path}:${index}:${raw}`,
      path,
      line: index,
      text,
      due,
      rawDue: raw,
      completed: /[xX]/.test(task[2] ?? "")
    });
  });
  return reminders;
}

interface Node {
  line: string | null;
  children: Node[];
  kind: "root" | "heading" | "task" | "text";
  level: number;
}

function levelOf(line: string): { kind: Node["kind"]; level: number } {
  const heading = line.match(HEADING);
  if (heading) return { kind: "heading", level: heading[1]?.length ?? 1 };
  const task = line.match(TASK);
  if (task) return { kind: "task", level: 10 + (task[1]?.replace(/\t/g, "    ").length ?? 0) };
  return { kind: "text", level: 1000 };
}

function structure(lines: string[]): Node {
  const root: Node = { line: null, children: [], kind: "root", level: 0 };
  const stack: Node[] = [root];
  for (const line of lines) {
    const info = levelOf(line);
    if (info.kind === "text") {
      stack.at(-1)?.children.push({ line, children: [], ...info });
      continue;
    }
    while (stack.length > 1) {
      const parent = stack.at(-1)!;
      if (info.kind === "task" && parent.kind === "heading") break;
      if (info.kind === "heading" && parent.kind === "task") stack.pop();
      else if (info.level <= parent.level) stack.pop();
      else break;
    }
    const node: Node = { line, children: [], ...info };
    stack.at(-1)?.children.push(node);
    stack.push(node);
  }
  return root;
}

function keepNode(node: Node, removeEmptyHeadings: boolean): Node | null {
  const children = node.children.map((child) => keepNode(child, removeEmptyHeadings)).filter((child): child is Node => child !== null);
  if (node.kind === "task") {
    const checked = /^\s*[-*+]\s+\[[xX]\]/.test(node.line ?? "");
    const hasOpenDescendant = children.some((child) => child.kind === "task" || containsTask(child));
    if (checked && !hasOpenDescendant) return null;
  }
  if (node.kind === "heading" && removeEmptyHeadings && !children.some(containsMeaningful)) return null;
  if (node.kind === "text" && !node.line?.trim()) return { ...node, children };
  return { ...node, children };
}

const containsTask = (node: Node): boolean => node.kind === "task" || node.children.some(containsTask);
const containsMeaningful = (node: Node): boolean => node.kind === "task" || (node.kind !== "text" && node.children.some(containsMeaningful));

function flatten(node: Node): string[] {
  return [...(node.line === null ? [] : [node.line]), ...node.children.flatMap(flatten)];
}

export function extractRollover(content: string, removeEmptyHeadings = true): string {
  const lines = stripFrontmatter(content.split("\n"));
  const filtered = keepNode(structure(lines), removeEmptyHeadings);
  return filtered ? flatten(filtered).join("\n").replace(/\n{3,}/g, "\n\n").trim() : "";
}

export function stripFrontmatter(lines: string[]): string[] {
  if (lines[0] !== "---") return lines;
  const end = lines.indexOf("---", 1);
  return end === -1 ? lines : lines.slice(end + 1);
}

function expandPart(part: string, min: number, max: number): Set<number> | null {
  if (part === "*") return null;
  const values = new Set<number>();
  for (const segment of part.split(",")) {
    const range = segment.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let value = Number(range[1]); value <= Number(range[2]); value++) if (value >= min && value <= max) values.add(value);
    } else {
      const value = Number(segment);
      if (value >= min && value <= max) values.add(value);
    }
  }
  return values;
}

export function scheduleMatches(expression: string, date: Date): boolean {
  const match = expression.match(SCHEDULE);
  if (!match) return false;
  const day = expandPart(match[1]!, 1, 31);
  const month = expandPart(match[2]!, 1, 12);
  const weekday = expandPart(match[3]!, 0, 6);
  return (!day || day.has(date.getDate())) && (!month || month.has(date.getMonth() + 1)) && (!weekday || weekday.has(date.getDay()));
}

export function renderTemplate(template: string, date: Date, title: string, previousPath = "", nextPath = ""): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const lines = template.split("\n");
  const scheduled: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!SCHEDULE.test(lines[index] ?? "")) continue;
    if (scheduleMatches(lines[index]!, date) && lines[index + 1] !== undefined) scheduled.push(lines[index + 1]!);
    lines.splice(index, 2);
    index--;
  }
  return [...lines, ...scheduled]
    .join("\n")
    .replace(/{{\s*date\s*}}/gi, iso)
    .replace(/{{\s*time\s*}}/gi, time)
    .replace(/{{\s*title\s*}}/gi, title)
    .replace(/{{\s*previous_note(?:_path)?\s*}}/gi, previousPath)
    .replace(/{{\s*next_note(?:_path)?\s*}}/gi, nextPath);
}

export function activityFromContent(date: string, content: string): DayActivity {
  let total = 0;
  let completed = 0;
  for (const line of content.split("\n")) {
    const task = line.match(TASK);
    if (!task) continue;
    total++;
    if (/[xX]/.test(task[2] ?? "")) completed++;
  }
  return { date, completed, total };
}

export function calculateStreak(activity: DayActivity[], today: Date): number {
  const byDate = new Map(activity.map((day) => [day.date, day.completed]));
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let streak = 0;
  for (;;) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if ((byDate.get(key) ?? 0) === 0) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function achievementsFor(activity: DayActivity[], streak: number): Achievement[] {
  const completed = activity.reduce((sum, day) => sum + day.completed, 0);
  const perfectDays = activity.filter((day) => day.total > 0 && day.completed === day.total).length;
  return [
    { id: "first-step", name: "First step", description: "Complete your first task", unlocked: completed >= 1 },
    { id: "momentum", name: "Momentum", description: "Complete 25 tasks", unlocked: completed >= 25 },
    { id: "century", name: "Century", description: "Complete 100 tasks", unlocked: completed >= 100 },
    { id: "three-day", name: "On a roll", description: "Build a 3-day streak", unlocked: streak >= 3 },
    { id: "week", name: "Full week", description: "Build a 7-day streak", unlocked: streak >= 7 },
    { id: "clear-day", name: "Clean slate", description: "Finish every task in a daily note", unlocked: perfectDays >= 1 }
  ];
}
