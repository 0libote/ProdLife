import { App, Notice, TFile, TFolder, moment, normalizePath } from "obsidian";
import { extractRollover, renderTemplate } from "./core";
import type { ProdLifeSettings } from "./types";

export class DailyNotesService {
  constructor(private app: App, private settings: () => ProdLifeSettings) {}

  async open(date = new Date()): Promise<TFile | null> {
    const settings = this.settings();
    const title = moment(date).format(settings.dateFormat);
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
      const base = renderTemplate(template, date, title, previousPath);
      const rollover = settings.rolloverTasks && previousContent
        ? extractRollover(previousContent, settings.removeEmptyHeadings)
        : "";
      const content = this.compose(base, rollover, title, previousPath);
      const file = await this.app.vault.create(path, content);
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
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${folder}/`) && this.dateFor(file) !== null);
  }

  dateFor(file: TFile): string | null {
    const folder = normalizePath(this.settings().dailyFolder);
    const relative = file.path.startsWith(`${folder}/`) ? file.path.slice(folder.length + 1, -3) : file.basename;
    const parsed = moment(relative, this.settings().dateFormat, true);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
  }

  findPrevious(date: Date): TFile | null {
    const before = moment(date).startOf("day");
    return this.dailyFiles()
      .map((file) => ({ file, date: moment(file.path.slice(normalizePath(this.settings().dailyFolder).length + 1, -3), this.settings().dateFormat, true) }))
      .filter((entry) => entry.date.isValid() && entry.date.isBefore(before))
      .sort((a, b) => b.date.valueOf() - a.date.valueOf())[0]?.file ?? null;
  }

  async archiveOldNotes(): Promise<number> {
    const archiveFolder = normalizePath(this.settings().archiveFolder);
    if (!archiveFolder) {
      new Notice("Set an archive folder in ProdLife settings first.");
      return 0;
    }
    const todayPath = moment().format(this.settings().dateFormat);
    const files = this.dailyFiles().filter((file) => file.path.slice(normalizePath(this.settings().dailyFolder).length + 1, -3) !== todayPath);
    let moved = 0;
    for (const file of files) {
      const relative = file.path.slice(normalizePath(this.settings().dailyFolder).length + 1);
      const destination = normalizePath(`${archiveFolder}/${relative}`);
      if (this.app.vault.getAbstractFileByPath(destination)) continue;
      await this.ensureFolder(destination.substring(0, destination.lastIndexOf("/")));
      await this.app.fileManager.renameFile(file, destination);
      moved++;
    }
    new Notice(moved ? `ProdLife archived ${moved} daily note${moved === 1 ? "" : "s"}.` : "No daily notes needed archiving.");
    return moved;
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

  private compose(template: string, rollover: string, title: string, previousPath: string): string {
    const navigation = previousPath ? `← [[${previousPath}|Previous]]` : "";
    const withRollover = template.includes("{{rollover}}")
      ? template.replace(/{{\s*rollover\s*}}/gi, rollover)
      : `${template.trim()}${rollover ? `\n\n## Rolled forward\n\n${rollover}` : ""}`;
    const frontmatter = `---\nprodlife: true\ndate: ${title}\n---`;
    return `${frontmatter}\n\n${withRollover.trim()}${navigation ? `\n\n---\n${navigation}` : ""}\n`;
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
