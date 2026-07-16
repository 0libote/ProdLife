import type { Achievement, DayActivity, ReminderItem } from "./types";

const TASK = /^(\s*)[-*+]\s+\[([^\]])\]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+\S/;
const SCHEDULE = /^\s*{{\s*(?:schedule|obligate)\s+([\d,*-]+)\s+([\d,*-]+)\s+([\d,*-]+)\s*}}\s*$/i;

export function parseLocalDate(value: string, defaultTime = "09:00"): number | null {
  const clean = value.replace(/\[\[([^\]]+)\]\]/g, (_, link: string) => link.split("|").at(-1) ?? link).trim();
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
    const raw = body.match(/\(@([^)]+)\)/)?.[1]
      ?? body.match(/@\{([^}]+)\}/)?.[1]
      ?? body.match(/⏰\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:?\d{0,2})?)/)?.[1]
      ?? body.match(/[📅📆🗓]\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
    if (!raw) return;
    const due = parseLocalDate(raw, defaultTime);
    if (due === null) return;
    const text = body
      .replace(/\(@[^)]+\)|@\{[^}]+\}|[⏰📅📆🗓]\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:?\d{0,2})?/u, "")
      .trim();
    reminders.push({
      id: `${path}:${index}:${raw}`,
      key: `${path}:${raw}:${text}`,
      path,
      line: index,
      text,
      due,
      rawDue: raw,
      completed: /[xX]/.test(task[2] ?? ""),
      allDay: !/\d{1,2}:\d{2}/.test(raw.replace(/\[\[|\]\]/g, ""))
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
    const current = stack[stack.length - 1];
    if (!current) continue;
    if (info.kind === "text") {
      current.children.push({ line, children: [], ...info });
      continue;
    }
    while (stack.length > 1) {
      const parent = stack[stack.length - 1];
      if (!parent) break;
      if (info.kind === "task" && parent.kind === "heading") break;
      if (info.kind === "heading" && parent.kind === "task") stack.pop();
      else if (info.level <= parent.level) stack.pop();
      else break;
    }
    const node: Node = { line, children: [], ...info };
    const parent = stack[stack.length - 1];
    if (!parent) continue;
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

function keepNode(node: Node, removeEmptyHeadings: boolean): Node | null {
  const children = node.children.map((child) => keepNode(child, removeEmptyHeadings)).filter((child): child is Node => child !== null);
  if (node.kind === "task") {
    const checked = /^\s*[-*+]\s+\[[xX]\]/.test(node.line ?? "");
    const hasOpenDescendant = children.some((child) => child.kind === "task" || containsTask(child));
    const blank = /^\s*[-*+]\s+\[[^\]]\]\s*$/.test(node.line ?? "");
    if (blank && !hasOpenDescendant) return null;
    if (checked && !hasOpenDescendant) return null;
  }
  if (node.kind === "heading" && removeEmptyHeadings && !children.some(containsMeaningful)) return null;
  if (node.kind === "text" && !node.line?.trim()) return { ...node, children };
  return { ...node, children };
}

const containsTask = (node: Node): boolean => node.kind === "task" || node.children.some(containsTask);
const containsMeaningful = (node: Node): boolean => node.kind === "task" || (node.kind !== "text" && node.children.some(containsMeaningful));

function flatten(node: Node): string[] {
  const lines = node.line === null ? [] : [node.line];
  for (const child of node.children) lines.push(...flatten(child));
  return lines;
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

export function renderTemplate(
  template: string,
  date: Date,
  title: string,
  previousPath = "",
  nextPath = "",
  format = (pattern: string): string => basicDateFormat(date, pattern)
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const source = template.split("\n");
  const lines: string[] = [];
  for (let index = 0; index < source.length; index++) {
    const line = source[index] ?? "";
    if (!SCHEDULE.test(line)) {
      lines.push(line);
      continue;
    }
    const scheduled = source[index + 1];
    if (scheduled !== undefined && scheduleMatches(line, date)) lines.push(scheduled);
    if (scheduled !== undefined) index++;
  }
  return lines
    .join("\n")
    .replace(/{{\s*date(?::([^}]+))?\s*}}/gi, (_, pattern: string | undefined) => pattern ? format(pattern.trim()) : iso)
    .replace(/{{\s*time(?::([^}]+))?\s*}}/gi, (_, pattern: string | undefined) => pattern ? format(pattern.trim()) : time)
    .replace(/{{\s*title\s*}}/gi, title)
    .replace(/{{\s*previous_note(?:_path)?\s*}}/gi, previousPath)
    .replace(/{{\s*next_note(?:_path)?\s*}}/gi, nextPath);
}

function basicDateFormat(date: Date, pattern: string): string {
  const values: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0")
  };
  return pattern.replace(/YYYY|MM|DD|HH|mm/g, (token) => values[token] ?? token);
}

export function upsertReminder(line: string, date: string, time: string, linkDate = true, linkTarget = date): string {
  const link = linkTarget === date ? `[[${date}]]` : `[[${linkTarget}|${date}]]`;
  const due = `(@${linkDate ? link : date}${time ? ` ${time}` : ""})`;
  const existing = /\(@[^)]+\)|@\{[^}]+\}|[⏰📅📆🗓]\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:?\d{0,2})?/u;
  return existing.test(line) ? line.replace(existing, due) : `${line.trimEnd()} ${due}`;
}

export function ensureDailyFrontmatter(content: string, date: string): string {
  if (!content.startsWith("---\n")) return `---\nprodlife: true\ndate: ${date}\n---\n\n${content}`;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return `---\nprodlife: true\ndate: ${date}\n---\n\n${content}`;
  const frontmatter = content.slice(4, end);
  const additions = [
    /^prodlife\s*:/m.test(frontmatter) ? "" : "prodlife: true",
    /^date\s*:/m.test(frontmatter) ? "" : `date: ${date}`
  ].filter(Boolean).join("\n");
  return additions ? `${content.slice(0, end)}\n${additions}${content.slice(end)}` : content;
}

export function activityFromContent(date: string, content: string): DayActivity {
  let total = 0;
  let completed = 0;
  for (const line of content.split("\n")) {
    const task = line.match(TASK);
    if (!task) continue;
    if (!task[3]?.trim()) continue;
    total++;
    if (/[xX]/.test(task[2] ?? "")) completed++;
  }
  return { date, completed, total };
}

export function calculateStreak(activity: DayActivity[], today: Date): number {
  const byDate = new Map(activity.map((day) => [day.date, day.completed]));
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if ((byDate.get(isoDate(cursor)) ?? 0) === 0) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (;;) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if ((byDate.get(key) ?? 0) === 0) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function achievementsFor(
  activity: DayActivity[],
  taskStreak: number,
  writing: Record<string, number> = {},
  unlocks: Record<string, number> = {}
): Achievement[] {
  const completed = activity.reduce((sum, day) => sum + day.completed, 0);
  const perfectDays = activity.filter((day) => day.total > 0 && day.completed === day.total).length;
  const wordValues = Object.values(writing);
  const totalWords = wordValues.reduce((sum, words) => sum + words, 0);
  const bestDay = Math.max(0, ...wordValues);
  const writingDays = wordValues.filter((words) => words > 0).length;
  const writingStreak = streakForValues(writing, new Date());
  const definitions: Array<Omit<Achievement, "progress" | "unlocked" | "unlockedAt"> & { value: number }> = [];
  const addMilestones = (
    category: Achievement["category"],
    icon: string,
    prefix: string,
    noun: string,
    value: number,
    targets: number[]
  ): void => {
    for (const target of targets) definitions.push({
      id: `${prefix}-${target}`,
      name: milestoneName(prefix, target),
      description: `${noun} ${target.toLocaleString()}${prefix === "words" || prefix === "best" ? " words" : ""}`,
      category,
      icon,
      target,
      value
    });
  };
  addMilestones("tasks", "circle-check-big", "tasks", "Complete", completed, [1, 10, 25, 50, 100, 250, 500, 1000]);
  addMilestones("writing", "pen-line", "words", "Write", totalWords, [100, 500, 1000, 5000, 10000, 25000, 50000, 100000]);
  addMilestones("writing", "sparkles", "best", "Write in one day", bestDay, [100, 250, 500, 1000, 2500, 5000]);
  addMilestones("streaks", "flame", "task-streak", "Build a task streak of", taskStreak, [3, 7, 14, 30, 60, 100, 365]);
  addMilestones("streaks", "feather", "writing-streak", "Build a writing streak of", writingStreak, [3, 7, 14, 30, 60, 100, 365]);
  addMilestones("consistency", "calendar-check", "perfect", "Complete every task on", perfectDays, [1, 5, 10, 25, 50, 100]);
  addMilestones("consistency", "calendar-days", "writing-days", "Write on", writingDays, [1, 7, 30, 100, 250, 365]);
  return definitions.map(({ value, ...achievement }) => ({
    ...achievement,
    progress: Math.min(value, achievement.target),
    unlocked: value >= achievement.target || Boolean(unlocks[achievement.id]),
    ...(unlocks[achievement.id] ? { unlockedAt: unlocks[achievement.id] } : {})
  }));
}

export function countWords(text: string): number {
  const matches = text.match(/[a-zA-Z0-9_\u0370-\u03ff\u00c0-\u024f\u0400-\u052f\u0590-\u06ff]+|[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu);
  return matches?.length ?? 0;
}

export function persistentWordTotal(total: number, previousSnapshot: number, currentSnapshot: number): number {
  return total + Math.max(0, currentSnapshot - previousSnapshot);
}

export function streakForValues(values: Record<string, number>, today: Date): number {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if ((values[isoDate(cursor)] ?? 0) <= 0) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while ((values[isoDate(cursor)] ?? 0) > 0) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export const isoDate = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function shouldArchiveDaily(date: string, today: Date, ageDays: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - Math.max(1, ageDays));
  return new Date(`${date}T00:00:00`).getTime() <= cutoff.getTime();
}

function milestoneName(prefix: string, target: number): string {
  const names: Record<string, string> = {
    tasks: "Task maker",
    words: "Wordsmith",
    best: "Flow state",
    "task-streak": "On a roll",
    "writing-streak": "Writing rhythm",
    perfect: "Clean slate",
    "writing-days": "Showing up"
  };
  return `${names[prefix] ?? "Milestone"} · ${target.toLocaleString()}`;
}
