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

  dailyFiles(): TFile[] {
    const folder = normalizePath(this.settings().dailyFolder);
    return this.filesIn(folder).filter((file) => this.dateFor(file) !== null);
  }

  trackedFiles(): TFile[] {
    const paths = [normalizePath(this.settings().dailyFolder)];
    const archive = normalizePath(this.settings().archiveFolder);
    if (archive) paths.push(archive);
    const files: TFile[] = [];
    for (const path of paths) files.push(...this.filesIn(path));
    return [...new Map(files.map((file) => [file.path, file])).values()];
  }

  dateFor(file: TFile): string | null {
    const relative = this.relativeDailyPath(file);
    if (relative === null) return null;
    const parsed = toMoment(relative, this.settings().dateFormat, true);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
  }

  findPrevious(date: Date): TFile | null {
    const before = toMoment(date).startOf("day");
    return this.dailyFiles()
      .map((file) => ({ file, date: toMoment(this.relativeDailyPath(file) ?? "", this.settings().dateFormat, true) }))
      .filter((entry) => entry.date.isValid() && entry.date.isBefore(before))
      .sort((a, b) => b.date.valueOf() - a.date.valueOf())[0]?.file ?? null;
  }

  async archiveOldNotes(ageDays = 1, notify = true, preservePath = ""): Promise<number> {
    const archiveFolder = normalizePath(this.settings().archiveFolder);
    if (!archiveFolder) {
      new Notice("Set an archive folder in ProdLife settings first.");
      return 0;
    }
    const today = new Date();
    const files = this.dailyFiles().filter((file) => {
      if (file.path === preservePath) return false;
      const date = this.dateFor(file);
      return date !== null && shouldArchiveDaily(date, today, ageDays);
    });
    let moved = 0;
    for (const file of files) {
      const relative = `${this.relativeDailyPath(file) ?? file.basename}.md`;
      const destination = normalizePath(`${archiveFolder}/${relative}`);
      if (this.app.vault.getAbstractFileByPath(destination)) continue;
      await this.ensureFolder(destination.substring(0, destination.lastIndexOf("/")));
      await this.app.fileManager.renameFile(file, destination);
      moved++;
    }
    if (notify) new Notice(moved ? `ProdLife archived ${moved} daily note${moved === 1 ? "" : "s"}.` : "No daily notes needed archiving.");
    return moved;
  }

  async autoArchive(): Promise<number> {
    const settings = this.settings();
    if (settings.autoArchiveMode === "off" || !settings.archiveFolder.trim()) return 0;
    const title = toMoment().format(settings.dateFormat);
    const today = this.app.vault.getAbstractFileByPath(normalizePath(`${settings.dailyFolder}/${title}.md`));
    const preserve = today instanceof TFile ? "" : this.findPrevious(new Date())?.path ?? "";
    return this.archiveOldNotes(settings.autoArchiveMode === "next-day" ? 1 : settings.autoArchiveDays, false, preserve);
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

  private relativeDailyPath(file: TFile): string | null {
    const folder = normalizePath(this.settings().dailyFolder);
    if (!folder) return file.path.slice(0, -3);
    return file.path.startsWith(`${folder}/`) ? file.path.slice(folder.length + 1, -3) : null;
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
