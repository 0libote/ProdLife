import { App, TFile, TFolder, normalizePath } from "obsidian";
import { countWords, isoDate, persistentWordTotal } from "./core";
import type { ProdLifeData, ProdLifeSettings } from "./types";

export class WritingTracker {
  private ready = false;
  private timers = new Map<string, number>();

  constructor(
    private app: App,
    private settings: () => ProdLifeSettings,
    private data: () => ProdLifeData,
    private persist: () => Promise<void>,
    private dateForDailyFile: (file: TFile) => string | null,
    private changed: () => void
  ) {}

  async initialize(): Promise<void> {
    const state = this.data();
    const backfill = !state.writingInitialized;
    for (const file of this.files()) {
      const words = countWords(await this.app.vault.cachedRead(file));
      state.writingFiles[file.path] = words;
      if (!backfill || words === 0) continue;
      const date = this.dateForDailyFile(file) ?? isoDate(new Date(file.stat.mtime));
      const day = state.writingHistory[date] ?? { words: 0, updatedAt: file.stat.mtime };
      day.words += words;
      day.updatedAt = Math.max(day.updatedAt, file.stat.mtime);
      state.writingHistory[date] = day;
    }
    state.writingInitialized = true;
    this.ready = true;
    await this.persist();
    this.changed();
  }

  schedule(file: TFile): void {
    if (!this.ready || !this.includes(file)) return;
    const existing = this.timers.get(file.path);
    if (existing !== undefined) window.clearTimeout(existing);
    this.timers.set(file.path, window.setTimeout(() => {
      this.timers.delete(file.path);
      void this.capture(file);
    }, 1200));
  }

  remove(path: string): void {
    const timer = this.timers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.timers.delete(path);
    delete this.data().writingFiles[path];
    void this.persist();
    this.changed();
  }

  rename(file: TFile, oldPath: string): void {
    const previous = this.data().writingFiles[oldPath];
    if (previous !== undefined) {
      this.data().writingFiles[file.path] = previous;
      delete this.data().writingFiles[oldPath];
    }
  }

  values(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.data().writingHistory).map(([date, day]) => [date, day.words]));
  }

  private async capture(file: TFile): Promise<void> {
    const state = this.data();
    const current = countWords(await this.app.vault.cachedRead(file));
    const previous = state.writingFiles[file.path] ?? 0;
    state.writingFiles[file.path] = current;
    const added = Math.max(0, current - previous);
    if (added > 0) {
      const date = isoDate(new Date());
      const day = state.writingHistory[date] ?? { words: 0, updatedAt: 0 };
      day.words = persistentWordTotal(day.words, previous, current);
      day.updatedAt = Date.now();
      state.writingHistory[date] = day;
    }
    await this.persist();
    this.changed();
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
