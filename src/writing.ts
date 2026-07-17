import { App, TFile, TFolder, normalizePath } from "obsidian";
import { countWords, isoDate } from "./core";
import type { ProdLifeData, ProdLifeSettings, WritingDay, WritingDeviceDay, WritingMetric, WritingMetrics } from "./types";

const METRIC_KEYS: Array<keyof WritingMetrics> = [
  "wordsAdded", "wordsRemoved", "charactersAdded", "charactersRemoved", "linesAdded", "linesRemoved"
];

export const emptyWritingMetrics = (): WritingMetrics => ({
  wordsAdded: 0,
  wordsRemoved: 0,
  charactersAdded: 0,
  charactersRemoved: 0,
  linesAdded: 0,
  linesRemoved: 0
});

export function diffWriting(previous: string, current: string): WritingMetrics {
  let start = 0;
  while (start < previous.length && start < current.length && previous[start] === current[start]) start++;
  let previousEnd = previous.length;
  let currentEnd = current.length;
  while (previousEnd > start && currentEnd > start && previous[previousEnd - 1] === current[currentEnd - 1]) {
    previousEnd--;
    currentEnd--;
  }
  const removed = previous.slice(start, previousEnd);
  const added = current.slice(start, currentEnd);
  return {
    wordsAdded: countWords(added),
    wordsRemoved: countWords(removed),
    charactersAdded: added.length,
    charactersRemoved: removed.length,
    linesAdded: added.match(/\n/g)?.length ?? 0,
    linesRemoved: removed.match(/\n/g)?.length ?? 0
  };
}

export function summarizeWritingDay(day?: WritingDay): WritingMetrics {
  const total = emptyWritingMetrics();
  if (!day) return total;
  const devices = day.devices;
  if (!devices || Object.keys(devices).length === 0) {
    total.wordsAdded = Math.max(0, day.words || 0);
    return total;
  }
  for (const device of Object.values(devices)) {
    for (const key of METRIC_KEYS) total[key] += Math.max(0, Number(device[key]) || 0);
  }
  return total;
}

export function normalizeWritingHistory(history: Record<string, WritingDay>): Record<string, WritingDay> {
  const normalized: Record<string, WritingDay> = {};
  for (const [date, source] of Object.entries(history)) {
    const devices: Record<string, WritingDeviceDay> = {};
    for (const [id, value] of Object.entries(source.devices ?? {})) {
      const metrics = emptyWritingMetrics();
      for (const key of METRIC_KEYS) metrics[key] = Math.max(0, Number(value[key]) || 0);
      devices[id] = { ...metrics, updatedAt: Number(value.updatedAt) || Number(source.updatedAt) || 0 };
    }
    if (Object.keys(devices).length === 0 && source.words > 0) {
      devices.legacy = { ...emptyWritingMetrics(), wordsAdded: source.words, updatedAt: source.updatedAt || 0 };
    }
    const day: WritingDay = { words: 0, updatedAt: Number(source.updatedAt) || 0, devices };
    day.words = summarizeWritingDay(day).wordsAdded;
    day.updatedAt = Math.max(day.updatedAt, ...Object.values(devices).map((device) => device.updatedAt));
    normalized[date] = day;
  }
  return normalized;
}

export function mergeWritingHistory(
  local: Record<string, WritingDay>,
  incoming: Record<string, WritingDay>
): Record<string, WritingDay> {
  const merged = normalizeWritingHistory(local);
  const external = normalizeWritingHistory(incoming);
  for (const [date, incomingDay] of Object.entries(external)) {
    const target = merged[date] ?? { words: 0, updatedAt: 0, devices: {} };
    target.devices ??= {};
    for (const [id, incomingDevice] of Object.entries(incomingDay.devices ?? {})) {
      const current = target.devices[id];
      if (!current) {
        target.devices[id] = { ...incomingDevice };
        continue;
      }
      for (const key of METRIC_KEYS) current[key] = Math.max(current[key], incomingDevice[key]);
      current.updatedAt = Math.max(current.updatedAt, incomingDevice.updatedAt);
    }
    target.updatedAt = Math.max(target.updatedAt, incomingDay.updatedAt);
    target.words = summarizeWritingDay(target).wordsAdded;
    merged[date] = target;
  }
  return merged;
}

export interface WritingBackfillEntry {
  date: string;
  content: string;
  mtime: number;
}

export function summarizeWritingBackfill(entries: WritingBackfillEntry[]): Record<string, WritingDeviceDay> {
  const days: Record<string, WritingDeviceDay> = {};
  for (const entry of entries) {
    if (!entry.content) continue;
    const day = days[entry.date] ?? { ...emptyWritingMetrics(), updatedAt: 0 };
    day.wordsAdded += countWords(entry.content);
    day.charactersAdded += entry.content.length;
    day.linesAdded += entry.content ? entry.content.split("\n").length : 0;
    day.updatedAt = Math.max(day.updatedAt, entry.mtime);
    days[entry.date] = day;
  }
  return days;
}

export class WritingTracker {
  private ready = false;
  private readonly snapshots = new Map<string, string>();
  private readonly captureTimers = new Map<string, number>();
  private readonly pendingCaptures = new Map<string, { file: TFile; content: string }>();
  private persistTimer: number | null = null;

  constructor(
    private readonly app: App,
    private readonly settings: () => ProdLifeSettings,
    private readonly data: () => ProdLifeData,
    private readonly persist: () => Promise<void>,
    private readonly dateForDailyFile: (file: TFile) => string | null,
    private readonly changed: (date: string | null) => void,
    private readonly deviceId: string
  ) {}

  async initialize(): Promise<void> {
    const state = this.data();
    state.writingHistory = normalizeWritingHistory(state.writingHistory);
    await this.backfill(false);
    this.ready = true;
    await this.persist();
    this.changed(null);
  }

  async rebuildBackfill(): Promise<{ files: number; failed: number }> {
    const result = await this.backfill(true);
    this.ready = true;
    await this.persist();
    this.changed(null);
    return result;
  }

  observe(file: TFile, content: string): void {
    if (!this.ready || !this.includes(file)) return;
    this.snapshots.set(file.path, content);
  }

  schedule(file: TFile, content: string): void {
    if (!this.ready || !this.includes(file)) return;
    const path = file.path;
    const timer = this.captureTimers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.pendingCaptures.set(path, { file, content });
    this.captureTimers.set(path, window.setTimeout(() => {
      this.captureTimers.delete(path);
      const pending = this.pendingCaptures.get(path);
      this.pendingCaptures.delete(path);
      if (pending) this.capture(pending.file, pending.content);
    }, 400));
  }

  capture(file: TFile, content: string): void {
    if (!this.ready || !this.includes(file)) return;
    const previous = this.snapshots.get(file.path);
    this.snapshots.set(file.path, content);
    if (previous === undefined || previous === content) return;
    // ponytail: This contiguous diff is deliberately simple. Use CodeMirror transactions only if multi-cursor edits prove inaccurate in real use.
    const change = diffWriting(previous, content);
    if (!METRIC_KEYS.some((key) => change[key] > 0)) return;
    const state = this.data();
    const date = isoDate(new Date());
    const day = state.writingHistory[date] ?? { words: 0, updatedAt: 0, devices: {} };
    day.devices ??= {};
    const device = day.devices[this.deviceId] ?? { ...emptyWritingMetrics(), updatedAt: 0 };
    for (const key of METRIC_KEYS) device[key] += change[key];
    device.updatedAt = Date.now();
    day.devices[this.deviceId] = device;
    day.words = summarizeWritingDay(day).wordsAdded;
    day.updatedAt = device.updatedAt;
    state.writingHistory[date] = day;
    state.writingFiles[file.path] = countWords(content);
    this.schedulePersist();
    this.changed(date);
  }

  remove(path: string): void {
    const timer = this.captureTimers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.captureTimers.delete(path);
    this.pendingCaptures.delete(path);
    this.snapshots.delete(path);
    delete this.data().writingFiles[path];
    this.schedulePersist();
  }

  rename(file: TFile, oldPath: string): void {
    const pending = this.pendingCaptures.get(oldPath);
    this.removePending(oldPath);
    if (pending) this.schedule(file, pending.content);
    const snapshot = this.snapshots.get(oldPath);
    if (snapshot !== undefined) {
      this.snapshots.set(file.path, snapshot);
      this.snapshots.delete(oldPath);
    }
    const previous = this.data().writingFiles[oldPath];
    if (previous !== undefined) {
      this.data().writingFiles[file.path] = previous;
      delete this.data().writingFiles[oldPath];
    }
  }

  values(metric: WritingMetric = "words"): Record<string, number> {
    const key = `${metric}Added` as keyof WritingMetrics;
    return Object.fromEntries(Object.entries(this.data().writingHistory).map(([date, day]) => [date, summarizeWritingDay(day)[key]]));
  }

  day(date: string): WritingMetrics {
    return summarizeWritingDay(this.data().writingHistory[date]);
  }

  async flush(): Promise<void> {
    for (const path of this.pendingCaptures.keys()) {
      const pending = this.pendingCaptures.get(path);
      this.removePending(path);
      if (pending) this.capture(pending.file, pending.content);
    }
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await this.persist();
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 900);
  }

  private async backfill(force: boolean): Promise<{ files: number; failed: number }> {
    const state = this.data();
    const missingBaseline = !state.writingInitialized;
    const missingMetrics = !state.writingMetricsInitialized;
    if (!force && !missingBaseline && !missingMetrics) return { files: 0, failed: 0 };

    const files = this.files();
    const missingEntries: WritingBackfillEntry[] = [];
    const metricEntries: WritingBackfillEntry[] = [];
    let failed = 0;
    const rebuildMetrics = missingMetrics && !missingBaseline;
    const scan = rebuildMetrics ? files : files.filter((file) => state.writingFiles[file.path] === undefined);
    for (let index = 0; index < scan.length; index += 16) {
      await Promise.all(scan.slice(index, index + 16).map(async (file) => {
        try {
          const content = await this.app.vault.cachedRead(file);
          const unseen = state.writingFiles[file.path] === undefined;
          state.writingFiles[file.path] = countWords(content);
          const entry = {
            content,
            date: this.dateForDailyFile(file) ?? isoDate(new Date(file.stat.mtime)),
            mtime: file.stat.mtime
          };
          if (unseen) missingEntries.push(entry);
          if (rebuildMetrics) metricEntries.push(entry);
        } catch (error) {
          failed++;
          console.warn(`ProdLife could not backfill ${file.path}`, error);
        }
      }));
    }

    for (const [date, aggregate] of Object.entries(summarizeWritingBackfill(missingEntries))) {
      const day = state.writingHistory[date] ?? { words: 0, updatedAt: 0, devices: {} };
      day.devices ??= {};
      const previous = day.devices.backfill ?? { ...emptyWritingMetrics(), updatedAt: 0 };
      day.devices.backfill = {
        ...previous,
        wordsAdded: previous.wordsAdded + aggregate.wordsAdded,
        charactersAdded: previous.charactersAdded + aggregate.charactersAdded,
        linesAdded: previous.linesAdded + aggregate.linesAdded,
        updatedAt: Math.max(previous.updatedAt, aggregate.updatedAt)
      };
      day.words = summarizeWritingDay(day).wordsAdded;
      day.updatedAt = Math.max(day.updatedAt, aggregate.updatedAt);
      state.writingHistory[date] = day;
    }
    for (const [date, aggregate] of Object.entries(summarizeWritingBackfill(metricEntries))) {
      const day = state.writingHistory[date] ?? { words: 0, updatedAt: 0, devices: {} };
      day.devices ??= {};
      const previous = day.devices.backfill ?? { ...emptyWritingMetrics(), updatedAt: 0 };
      day.devices.backfill = {
        ...previous,
        charactersAdded: aggregate.charactersAdded,
        linesAdded: aggregate.linesAdded,
        updatedAt: Math.max(previous.updatedAt, aggregate.updatedAt)
      };
      delete day.devices["metrics-backfill"];
      day.words = summarizeWritingDay(day).wordsAdded;
      day.updatedAt = Math.max(day.updatedAt, aggregate.updatedAt);
      state.writingHistory[date] = day;
    }
    if (missingBaseline) state.writingInitialized = failed === 0;
    if (missingMetrics) state.writingMetricsInitialized = failed === 0;
    return { files: missingEntries.length, failed };
  }

  private removePending(path: string): void {
    const timer = this.captureTimers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.captureTimers.delete(path);
    this.pendingCaptures.delete(path);
  }

  private files(): TFile[] {
    const folders = this.settings().writingFolders.map((path) => normalizePath(path.trim())).filter(Boolean);
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

  private includes(file: TFile): boolean {
    if (file.extension !== "md") return false;
    const folders = this.settings().writingFolders.map((path) => normalizePath(path.trim())).filter(Boolean);
    return !folders.length || folders.some((path) => file.path === path || file.path.startsWith(`${path}/`));
  }
}
