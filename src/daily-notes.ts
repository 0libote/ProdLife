import { App, Notice, TFile, TFolder, moment as obsidianMoment, normalizePath } from "obsidian";
import { ensureDailyFrontmatter, extractRollover, renderTemplate, shouldArchiveDaily } from "./core";
import type { ProdLifeSettings } from "./types";

interface MomentValue {
  format(pattern: string): string;
  isBefore(other: MomentValue): boolean;
  isValid(): boolean;
  startOf(unit: "day"): MomentValue;
  valueOf(): number;
}

interface MomentFactory {
  (): MomentValue;
  (value: Date): MomentValue;
  (value: string, pattern: string, strict: boolean): MomentValue;
}

const toMoment = obsidianMoment as unknown as MomentFactory;

export class DailyNotesService {
  constructor(private app: App, private settings: () => ProdLifeSettings) {}

  async open(date = new Date()): Promise<TFile | null> {
    const settings = this.settings();
    const title = toMoment(date).format(settings.dateFormat);
    const path = normalizePath(`${settings.dailyFolder}/${title}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(existing);
      return existing;
    }
    if (existing) {
      new Notice(`ProdLife cannot create ${path}: another item already uses that path.`);
      return null;
    }

    try {
      await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
      const previous = this.findPrevious(date);
      const previousContent = previous ? await this.app.vault.cachedRead(previous) : "";
      const template = await this.readTemplate(date);
      const previousPath = previous?.path.replace(/\.md$/, "") ?? "";
      const base = renderTemplate(template, date, title, previousPath, "", (pattern) => toMoment(date).format(pattern));
      const rollover = settings.rolloverTasks && previousContent
        ? this.cleanRollover(extractRollover(previousContent.replace(/\n---\n← \[\[[^\n]+\]\]\s*$/, ""), settings.removeEmptyHeadings), previous)
        : "";
      const content = this.compose(base, rollover, toMoment(date).format("YYYY-MM-DD"), previousPath);
      const file = await this.app.vault.create(path, content);
      await this.linkPreviousToNext(previous, file);
      await this.autoArchive();
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`ProdLife created ${title}.`);
      return file;
    } catch (error) {
      console.error("ProdLife failed to create a daily note", error);
      new Notice(`ProdLife could not create today's note: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  linkFor(date: string): string {
    const parsed = toMoment(date, "YYYY-MM-DD", true);
    if (!parsed.isValid()) return date;
    return normalizePath(`${this.settings().dailyFolder.trim()}/${parsed.format(this.settings().dateFormat)}`);
  }

  dailyFiles(): TFile[] {
    const folder = folderPath(this.settings().dailyFolder);
    return this.filesIn(folder).filter((file) => this.dateForIn(file, folder) !== null);
  }

  trackedFiles(): TFile[] {
    const paths = [folderPath(this.settings().dailyFolder)];
    const archive = folderPath(this.settings().archiveFolder);
    if (archive) paths.push(archive);
    const files: TFile[] = [];
    for (const path of paths) files.push(...this.filesIn(path).filter((file) => this.dateForIn(file, path) !== null));
    return [...new Map(files.map((file) => [file.path, file])).values()];
  }

  dateFor(file: TFile): string | null {
    return this.dateForIn(file, folderPath(this.settings().dailyFolder))
      ?? this.dateForIn(file, folderPath(this.settings().archiveFolder));
  }

  findPrevious(date: Date): TFile | null {
    const before = toMoment(date).startOf("day");
    return this.trackedFiles()
      .map((file) => ({ file, date: toMoment(this.relativePathIn(file, this.folderFor(file)) ?? "", this.settings().dateFormat, true) }))
      .filter((entry) => entry.date.isValid() && entry.date.isBefore(before))
      .sort((a, b) => b.date.valueOf() - a.date.valueOf())[0]?.file ?? null;
  }

  async archiveOldNotes(ageDays = 1, notify = true): Promise<number> {
    const archiveFolder = folderPath(this.settings().archiveFolder);
    if (!archiveFolder) {
      new Notice("Set an archive folder in ProdLife settings first.");
      return 0;
    }
    const dailyFolder = folderPath(this.settings().dailyFolder);
    if (archiveFolder === dailyFolder) {
      new Notice("The daily note and archive folders must be different.");
      return 0;
    }
    const today = new Date();
    const files = this.dailyFiles().filter((file) => {
      const date = this.dateFor(file);
      return date !== null && shouldArchiveDaily(date, today, ageDays);
    });
    const { moved, conflicts, failed } = await this.archiveFiles(files, dailyFolder, archiveFolder);
    if (notify) {
      let archived = "archived none";
      if (moved > 0) archived = `archived ${moved} daily note${moved === 1 ? "" : "s"}`;
      const details = [
        archived,
        conflicts ? `${conflicts} already existed` : "",
        failed ? `${failed} failed` : ""
      ].filter(Boolean).join(" · ");
      new Notice(files.length ? `ProdLife ${details}.` : "No daily notes needed archiving.");
    }
    return moved;
  }

  private async archiveFiles(files: TFile[], dailyFolder: string, archiveFolder: string): Promise<{ moved: number; conflicts: number; failed: number }> {
    let moved = 0;
    let conflicts = 0;
    let failed = 0;
    for (const file of files) {
      const relative = `${this.relativePathIn(file, dailyFolder) ?? file.basename}.md`;
      const result = await this.archiveFile(file, normalizePath(`${archiveFolder}/${relative}`));
      if (result === "moved") moved++;
      else if (result === "conflict") conflicts++;
      else failed++;
    }
    return { moved, conflicts, failed };
  }

  private async archiveFile(file: TFile, destination: string): Promise<"moved" | "conflict" | "failed"> {
    if (this.app.vault.getAbstractFileByPath(destination)) return "conflict";
    try {
      await this.ensureFolder(destination.substring(0, destination.lastIndexOf("/")));
      await this.app.fileManager.renameFile(file, destination);
      return "moved";
    } catch (error) {
      console.error(`ProdLife could not archive ${file.path}`, error);
      return "failed";
    }
  }

  async autoArchive(): Promise<number> {
    const settings = this.settings();
    if (settings.autoArchiveMode === "off" || !settings.archiveFolder.trim()) return 0;
    return this.archiveOldNotes(settings.autoArchiveMode === "next-day" ? 1 : settings.autoArchiveDays, false);
  }

  async addTaskToTemplate(path: string, title: string, time: string, allDay: boolean): Promise<boolean> {
    const normalized = normalizePath(path.endsWith(".md") ? path : `${path}.md`);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      new Notice(`ProdLife template not found: ${normalized}.`);
      return false;
    }
    const reminder = `(@{{date:YYYY-MM-DD}}${allDay || !time ? "" : ` ${time}`})`;
    await this.app.vault.process(file, (content) => {
      const lines = content.split("\n");
      const heading = lines.findIndex((line) => /^##\s+Today\s*$/i.test(line));
      const task = `- [ ] ${title.trim()} ${reminder}`;
      if (heading === -1) return `${content.trimEnd()}\n\n## Today\n${task}\n`;
      let insertAt = heading + 1;
      while (insertAt < lines.length && !/^#{1,6}\s+/.test(lines[insertAt] ?? "")) insertAt++;
      lines.splice(insertAt, 0, task);
      return lines.join("\n");
    });
    new Notice(`Added “${title.trim()}” to ${file.basename}.`);
    return true;
  }

  private async readTemplate(date: Date): Promise<string> {
    const settings = this.settings();
    const weekdayPath = settings.weekdayTemplates[String(date.getDay())]?.trim();
    const path = weekdayPath || settings.defaultTemplate.trim();
    if (!path) return "# {{date}}\n\n## Focus\n\n- [ ] \n\n## Notes\n\n## Reflection\n";
    const normalized = normalizePath(path.endsWith(".md") ? path : `${path}.md`);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      new Notice(`ProdLife template not found: ${normalized}. Using the built-in template.`);
      return "# {{date}}\n\n## Focus\n\n- [ ] \n\n## Notes\n\n## Reflection\n";
    }
    return this.app.vault.cachedRead(file);
  }

  private compose(template: string, rollover: string, isoDate: string, previousPath: string): string {
    const navigation = previousPath ? `← [[${previousPath}|Previous]]` : "";
    const withRollover = template.includes("{{rollover}}")
      ? template.replace(/{{\s*rollover\s*}}/gi, rollover)
      : `${template.trim()}${rollover ? `\n\n## Rolled forward\n\n${rollover}` : ""}`;
    return `${ensureDailyFrontmatter(withRollover.trim(), isoDate)}${navigation ? `\n\n---\n${navigation}` : ""}\n`;
  }

  private filesIn(path: string): TFile[] {
    const root = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
    if (!(root instanceof TFolder)) return [];
    const files: TFile[] = [];
    const visit = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "md") files.push(child);
        else if (child instanceof TFolder) visit(child);
      }
    };
    visit(root);
    return files;
  }

  private relativePathIn(file: TFile, folder: string): string | null {
    if (!folder) return file.path.includes("/") && !this.settings().dateFormat.includes("/") ? null : file.path.slice(0, -3);
    return file.path.startsWith(`${folder}/`) ? file.path.slice(folder.length + 1, -3) : null;
  }

  private dateForIn(file: TFile, folder: string): string | null {
    const relative = this.relativePathIn(file, folder);
    if (relative === null) return null;
    const parsed = toMoment(relative, this.settings().dateFormat, true);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
  }

  private folderFor(file: TFile): string {
    const daily = folderPath(this.settings().dailyFolder);
    return this.relativePathIn(file, daily) !== null ? daily : folderPath(this.settings().archiveFolder);
  }

  private async linkPreviousToNext(previous: TFile | null, next: TFile): Promise<void> {
    if (!previous) return;
    const nextPath = next.path.replace(/\.md$/, "");
    await this.app.vault.process(previous, (content) => {
      if (content.includes(`[[${nextPath}|Next]]`)) return content;
      const nextLink = `[[${nextPath}|Next]] →`;
      return /\n---\n← \[\[[^\n]+\]\]\s*$/.test(content)
        ? content.replace(/(\n---\n← \[\[[^\n]+\]\])\s*$/, `$1 · ${nextLink}\n`)
        : `${content.trimEnd()}\n\n---\n${nextLink}\n`;
    });
  }

  private cleanRollover(content: string, previous: TFile | null): string {
    if (!previous) return content;
    const lines = content.split("\n");
    if (lines[0]?.trim() === `# ${previous.basename}`) lines.shift();
    return lines.join("\n").trim();
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!path || this.app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
    const parts = normalizePath(path).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
}

const folderPath = (path: string): string => path.trim() ? normalizePath(path.trim()) : "";
