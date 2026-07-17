import { App, Modal, Notice, PluginSettingTab, Setting, TextComponent, type SettingDefinitionItem } from "obsidian";
import type ProdLifePlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export class ProdLifeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ProdLifePlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Getting started",
        items: [
          {
            name: "Setup guide",
            desc: "Review the recommended workflow without changing anything until you confirm.",
            render: (setting) => { setting.addButton((button) => button.setButtonText("Open guide").onClick(() => this.plugin.openSetupGuide())); }
          },
          {
            name: "Import your current workflow",
            desc: "Copy compatible Daily Notes and Reminder settings without changing notes.",
            aliases: ["migration", "Daily Notes", "Reminder"],
            render: (setting) => { setting.addButton((button) => button.setButtonText("Import settings").onClick(() => void this.plugin.importLegacySettings())); }
          }
        ]
      },
      {
        type: "page",
        name: "Daily notes",
        desc: "Folders, templates, rollover, and archiving.",
        items: [
          {
            type: "group",
            heading: "Location and templates",
            items: [
              { name: "Daily notes folder", desc: "Leave blank for the vault root.", control: { type: "folder", key: "dailyFolder", placeholder: "Vault root", includeRoot: true } },
              { name: "Date format", desc: "Moment.js format used for note names.", control: { type: "text", key: "dateFormat", placeholder: "YYYY-MM-DD", validate: (value) => value.trim() ? undefined : "Enter a date format." } },
              { name: "Default template", desc: "Used unless a weekday override is set.", control: { type: "text", key: "defaultTemplate", placeholder: "Templates/Daily" } },
              {
                name: "Weekday template",
                desc: "Choose a day, then optionally give it a different template.",
                render: (setting) => {
                  let selectedDay = String(new Date().getDay());
                  let template: TextComponent | null = null;
                  setting
                    .addDropdown((dropdown) => {
                      DAYS.forEach((day, index) => { dropdown.addOption(String(index), day); });
                      dropdown.setValue(selectedDay).onChange((value) => {
                        selectedDay = value;
                        template?.setValue(this.plugin.settings.weekdayTemplates[value] ?? "");
                      });
                    })
                    .addText((text) => {
                      template = text;
                      text.inputEl.setAttr("aria-label", "Selected weekday template");
                      text.setPlaceholder("Weekday override").setValue(this.plugin.settings.weekdayTemplates[selectedDay] ?? "").onChange(async (value) => {
                        this.plugin.settings.weekdayTemplates[selectedDay] = value.trim();
                        await this.plugin.saveSettings();
                      });
                    });
                }
              },
              {
                name: "Recurring template task",
                desc: "Add a dated task without writing template formulas.",
                render: (setting) => { setting.addButton((button) => button.setButtonText("Add task").onClick(() => new TemplateTaskModal(this.app, this.plugin).open())); }
              }
            ]
          },
          {
            type: "group",
            heading: "Rollover and archive",
            items: [
              { name: "Roll unfinished tasks forward", desc: "Preserve open tasks, nested children, and their headings.", control: { type: "toggle", key: "rolloverTasks" } },
              { name: "Remove empty headings", desc: "Do not carry headings with no unfinished tasks.", control: { type: "toggle", key: "removeEmptyHeadings" } },
              { name: "Archive folder", desc: "Where old daily notes move. ProdLife never deletes them.", control: { type: "folder", key: "archiveFolder", placeholder: "Archive/Daily" } },
              { name: "Automatic archiving", desc: "Manual keeps notes in place until you run the archive command.", control: { type: "dropdown", key: "autoArchiveMode", options: { off: "Manual", "next-day": "Next day", "after-days": "After days" } } },
              { name: "Archive after", desc: "Number of complete days to keep in the daily-note folder.", visible: () => this.plugin.settings.autoArchiveMode === "after-days", control: { type: "number", key: "autoArchiveDays", min: 1, step: 1, validate: (value) => Number.isInteger(value) && value > 0 ? undefined : "Enter a whole number above zero." } }
            ]
          },
          {
            type: "page",
            name: "Template reference",
            desc: "Variables and weekday schedule syntax.",
            items: [{
              name: "Available variables",
              desc: "{{date}}  {{time}}  {{title}}  {{previous_note}}  {{rollover}}\n{{schedule * * 1-5}} applies the following task Monday to Friday."
            }]
          }
        ]
      },
      {
        type: "page",
        name: "Reminders",
        desc: "Notification behavior, linked dates, scan scope, and snoozing.",
        items: [
          {
            type: "group",
            items: [
              { name: "Enable reminders", desc: "Check the vault for due reminders and show actionable notifications.", control: { type: "toggle", key: "remindersEnabled" } },
              { name: "Default reminder time", desc: "Used when a reminder specifies a date without a time.", control: { type: "text", key: "defaultReminderTime", placeholder: "09:00", validate: validTime } },
              { name: "Link reminder dates", desc: "Link new reminders to the matching daily note while keeping an ISO due date.", control: { type: "toggle", key: "linkReminderDates" } }
            ]
          },
          {
            type: "page",
            name: "Scope and timing",
            desc: "Vault scanning, snooze choices, and startup timing.",
            items: [
              {
                name: "Reminder folders",
                desc: "Comma-separated folders or files. Leave blank to scan the whole vault.",
                render: (setting) => { setting.addText((text) => text.setPlaceholder("Daily, FTL").setValue(this.plugin.settings.reminderFolders.join(", ")).onChange((value) => this.saveList("reminderFolders", value, true))); }
              },
              {
                name: "Snooze options",
                desc: "Comma-separated choices in minutes. 1440 is one day.",
                render: (setting) => { setting.addText((text) => text.setPlaceholder("30, 60, 180, 1440").setValue(this.plugin.settings.snoozeMinutes.join(", ")).onChange(async (value) => {
                  const minutes = value.split(",").map(Number).filter((item) => Number.isFinite(item) && item > 0);
                  if (minutes.length) await this.save("snoozeMinutes", minutes);
                })); }
              },
              { name: "Scan interval", desc: "Seconds between checks. Takes effect after reloading the plugin.", control: { type: "slider", key: "reminderIntervalSeconds", min: 15, max: 300, step: 15, displayFormat: (value) => `${value}s` } },
              { name: "Startup delay", desc: "Wait for sync before overdue reminders and auto-archiving.", control: { type: "slider", key: "startupDelaySeconds", min: 5, max: 120, step: 5, displayFormat: (value) => `${value}s` } }
            ]
          }
        ]
      },
      {
        type: "page",
        name: "Dashboard and writing",
        desc: "Heatmap tracking, goals, and dashboard layout.",
        items: [
          {
            type: "group",
            items: [
              {
                name: "Writing folders",
                desc: "Comma-separated files or folders. Leave blank for the whole vault.",
                render: (setting) => { setting.addText((text) => text.setPlaceholder("Daily, Notes").setValue(this.plugin.settings.writingFolders.join(", ")).onChange((value) => this.saveList("writingFolders", value))); }
              },
              { name: "Daily word goal", desc: "Controls heatmap intensity and writing achievements.", control: { type: "number", key: "writingGoal", min: 1, step: 1, validate: (value) => Number.isInteger(value) && value > 0 ? undefined : "Enter a whole number above zero." } },
              { name: "Default heatmap view", control: { type: "dropdown", key: "heatmapMode", options: { year: "Year", month: "Month" } } },
              { name: "Default heatmap metric", desc: "Removed amounts remain visible in each day’s detail.", control: { type: "dropdown", key: "heatmapMetric", options: { words: "Words added", characters: "Characters added", lines: "Lines added" } } },
              {
                name: "Backfill writing history",
                desc: "Scan newly tracked files and resume an interrupted first run without counting completed files twice.",
                aliases: ["backfill", "rescan", "repair heatmap"],
                render: (setting) => { setting.addButton((button) => button.setButtonText("Scan now").onClick(() => void this.plugin.rebuildWritingHistory())); }
              },
              {
                name: "Dashboard layout",
                desc: "Choose, hide, and reorder dashboard sections.",
                render: (setting) => { setting.addButton((button) => button.setButtonText("Customize").onClick(() => void this.plugin.openDashboardCustomizer())); }
              }
            ]
          }
        ]
      },
      {
        type: "page",
        name: "Productivity pet",
        desc: "Check-ins, name, frequency, and messages.",
        items: [
          {
            type: "group",
            items: [
              { name: "Enable pet check-ins", desc: "Let your pet occasionally offer a small prompt.", control: { type: "toggle", key: "petEnabled" } },
              { name: "Pet name", control: { type: "text", key: "petName", placeholder: "Pip", validate: (value) => value.trim() ? undefined : "Enter a name." } },
              { name: "Check-in frequency", desc: "Takes effect after reloading the plugin.", control: { type: "slider", key: "petCheckInMinutes", min: 30, max: 240, step: 15, displayFormat: (value) => `${value} min` } },
              {
                name: "Pet quotes",
                desc: "One message per line.",
                render: (setting) => { setting.addTextArea((area) => area.setValue(this.plugin.settings.quotes.join("\n")).onChange(async (value) => {
                  const quotes = value.split("\n").map((line) => line.trim()).filter(Boolean);
                  if (quotes.length) await this.save("quotes", quotes);
                })); }
              }
            ]
          }
        ]
      }
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS)) return;
    if (typeof value === "string" && ["dailyFolder", "dateFormat", "defaultTemplate", "archiveFolder", "defaultReminderTime", "petName"].includes(key)) value = value.trim();
    if (key === "autoArchiveMode" && value !== "off" && !this.plugin.settings.archiveFolder.trim()) this.plugin.settings.archiveFolder = "Archive/Daily";
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings(key === "defaultReminderTime");
    if (key === "autoArchiveMode") {
      const refresh = (this as unknown as { refreshDomState?: () => void }).refreshDomState;
      refresh?.call(this);
      const update = (this as unknown as { update?: () => void }).update;
      update?.call(this);
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("prodlife-settings");
    const intro = containerEl.createDiv({ cls: "prodlife-settings-intro" });
    intro.createEl("strong", { cls: "prodlife-settings-title", text: "ProdLife" });
    intro.createEl("p", { text: "Choose where your day lives, when reminders appear, and what progress ProdLife keeps." });

    new Setting(containerEl).setName("Getting started").setHeading();
    new Setting(containerEl)
      .setName("Setup guide")
      .setDesc("Review the recommended workflow without changing anything until you confirm.")
      .addButton((button) => button.setButtonText("Open guide").onClick(() => this.plugin.openSetupGuide()));
    new Setting(containerEl)
      .setName("Import your current workflow")
      .setDesc("Copy compatible Daily Notes and Reminder settings. Notes are not changed. Daily Five users should keep its fallback folder and date format matched to ProdLife.")
      .addButton((button) => button.setButtonText("Import settings").onClick(() => void this.plugin.importLegacySettings()));

    new Setting(containerEl).setName("Daily notes").setHeading();
    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder where ProdLife creates daily notes. Leave blank for the vault root. Nested date formats are supported.")
      .addText((text) => text.setPlaceholder("Vault root").setValue(this.plugin.settings.dailyFolder).onChange((value) => this.save("dailyFolder", value.trim())));
    new Setting(containerEl)
      .setName("Date format")
      .setDesc("Moment.js format used for note names, for example YYYY-MM-DD or YYYY/MM/YYYY-MM-DD.")
      .addText((text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dateFormat).onChange((value) => this.save("dateFormat", value.trim() || "YYYY-MM-DD")));
    new Setting(containerEl)
      .setName("Default template")
      .setDesc("Used unless a weekday override is set.")
      .addText((text) => text.setPlaceholder("Templates/Daily").setValue(this.plugin.settings.defaultTemplate).onChange((value) => this.save("defaultTemplate", value.trim())));
    let weekdayTemplate: TextComponent | null = null;
    let selectedDay = String(new Date().getDay());
    new Setting(containerEl)
      .setName("Weekday template")
      .setDesc("Choose a day, then optionally give it a different template.")
      .addDropdown((dropdown) => {
        DAYS.forEach((day, index) => { dropdown.addOption(String(index), day); });
        dropdown.setValue(selectedDay).onChange((value) => {
          selectedDay = value;
          weekdayTemplate?.setValue(this.plugin.settings.weekdayTemplates[value] ?? "");
        });
      })
      .addText((text) => {
        weekdayTemplate = text;
        text.inputEl.setAttr("aria-label", "Selected weekday template");
        text.setPlaceholder("Weekday override").setValue(this.plugin.settings.weekdayTemplates[selectedDay] ?? "").onChange(async (value) => {
          this.plugin.settings.weekdayTemplates[selectedDay] = value.trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Recurring template task")
      .setDesc("Add a dated task without writing template formulas.")
      .addButton((button) => button.setButtonText("Add task").onClick(() => new TemplateTaskModal(this.app, this.plugin).open()));
    new Setting(containerEl)
      .setName("Roll unfinished tasks forward")
      .setDesc("Preserve open tasks, nested children, and their headings from the previous daily note.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.rolloverTasks).onChange((value) => this.save("rolloverTasks", value)));
    new Setting(containerEl)
      .setName("Remove empty headings")
      .setDesc("Do not carry headings that contain no unfinished tasks into the next note.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.removeEmptyHeadings).onChange((value) => this.save("removeEmptyHeadings", value)));
    new Setting(containerEl)
      .setName("Archive folder")
      .setDesc("Where old daily notes move. ProdLife never deletes them.")
      .addText((text) => text.setPlaceholder("Archive/Daily").setValue(this.plugin.settings.archiveFolder).onChange((value) => this.save("archiveFolder", value.trim())));
    let archiveAfter: Setting | null = null;
    new Setting(containerEl)
      .setName("Automatic archiving")
      .setDesc("Manual keeps every note in place until you run the archive command.")
      .addDropdown((dropdown) => dropdown
        .addOption("off", "Manual")
        .addOption("next-day", "Next day")
        .addOption("after-days", "After days")
        .setValue(this.plugin.settings.autoArchiveMode)
        .onChange((value) => {
          if (value !== "off" && value !== "next-day" && value !== "after-days") return;
          if (value !== "off" && !this.plugin.settings.archiveFolder.trim()) {
            this.plugin.settings.archiveFolder = "Archive/Daily";
          }
          void this.save("autoArchiveMode", value).then(() => archiveAfter?.settingEl.toggleClass("is-hidden", value !== "after-days"));
        }));
    archiveAfter = new Setting(containerEl)
      .setName("Archive after")
      .setDesc("Number of complete days to keep in the daily-note folder.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(String(this.plugin.settings.autoArchiveDays)).onChange((value) => {
          const days = Number(value);
          if (Number.isInteger(days) && days > 0) void this.save("autoArchiveDays", days);
        });
      });
    archiveAfter.settingEl.toggleClass("is-hidden", this.plugin.settings.autoArchiveMode !== "after-days");

    new Setting(containerEl).setName("Reminders").setHeading();
    new Setting(containerEl)
      .setName("Enable reminders")
      .setDesc("Check the vault for due reminders and show actionable notifications inside Obsidian.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.remindersEnabled).onChange((value) => this.save("remindersEnabled", value)));
    new Setting(containerEl)
      .setName("Default reminder time")
      .setDesc("Time used for reminders that specify a date without a time.")
      .addText((text) => text.setPlaceholder("09:00").setValue(this.plugin.settings.defaultReminderTime).onChange((value) => this.save("defaultReminderTime", /^\d{1,2}:\d{2}$/.test(value) ? value : "09:00")));
    new Setting(containerEl)
      .setName("Link reminder dates")
      .setDesc("Link new reminders to the matching daily note path while keeping an ISO due date for reliable parsing.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.linkReminderDates).onChange((value) => this.save("linkReminderDates", value)));
    const reminderAdvanced = containerEl.createEl("details", { cls: "prodlife-settings-details" });
    reminderAdvanced.createEl("summary", { text: "Reminder scope and timing" });
    reminderAdvanced.createEl("p", { text: "Change these only if vault-wide scanning or the defaults do not suit your workflow." });
    new Setting(reminderAdvanced)
      .setName("Reminder folders")
      .setDesc("Comma-separated folders or files to scan. Leave blank to scan Markdown files across the vault, which matches Reminder's behavior.")
      .addText((text) => text
        .setPlaceholder("Daily, FTL")
        .setValue(this.plugin.settings.reminderFolders.join(", "))
        .onChange((value) => this.save("reminderFolders", value.split(",").map((path) => path.trim()).filter(Boolean))));
    new Setting(reminderAdvanced)
      .setName("Snooze options")
      .setDesc("Comma-separated delay choices in minutes. 1440 is one day and 10080 is one week.")
      .addText((text) => text
        .setPlaceholder("30, 60, 180, 1440, 10080")
        .setValue(this.plugin.settings.snoozeMinutes.join(", "))
        .onChange((value) => {
          const minutes = value.split(",").map(Number).filter((item) => Number.isFinite(item) && item > 0);
          if (minutes.length) void this.save("snoozeMinutes", minutes);
        }));
    new Setting(reminderAdvanced)
      .setName("Scan interval")
      .setDesc("Seconds between reminder checks. Takes effect after reloading the plugin.")
      .addSlider((slider) => slider.setLimits(15, 300, 15).setValue(this.plugin.settings.reminderIntervalSeconds).onChange((value) => this.save("reminderIntervalSeconds", value)));
    new Setting(reminderAdvanced)
      .setName("Startup delay")
      .setDesc("Wait for Obsidian Sync or another sync plugin before showing overdue reminders and auto-archiving.")
      .addSlider((slider) => slider.setLimits(5, 120, 5).setValue(this.plugin.settings.startupDelaySeconds).onChange((value) => this.save("startupDelaySeconds", value)));

    new Setting(containerEl).setName("Dashboard and writing").setHeading();
    new Setting(containerEl)
      .setName("Writing folders")
      .setDesc("Comma-separated files or folders for permanent words, characters, and lines tracking. Leave blank for the whole vault. The first run scans them once; later updates are incremental.")
      .addText((text) => text.setPlaceholder("Daily, Notes").setValue(this.plugin.settings.writingFolders.join(", ")).onChange((value) => this.save("writingFolders", value.split(",").map((path) => path.trim()).filter(Boolean))));
    new Setting(containerEl)
      .setName("Backfill writing history")
      .setDesc("Scan newly tracked files after changing writing folders or if the first backfill was interrupted.")
      .addButton((button) => button.setButtonText("Scan now").onClick(() => void this.plugin.rebuildWritingHistory()));
    new Setting(containerEl)
      .setName("Daily word goal")
      .setDesc("Controls heatmap intensity and writing achievements.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(String(this.plugin.settings.writingGoal)).onChange((value) => {
          const goal = Number(value);
          if (Number.isInteger(goal) && goal > 0) void this.save("writingGoal", goal);
        });
      });
    new Setting(containerEl)
      .setName("Default heatmap view")
      .addDropdown((dropdown) => dropdown.addOption("year", "Year").addOption("month", "Month").setValue(this.plugin.settings.heatmapMode).onChange((value) => {
        if (value === "year" || value === "month") return this.save("heatmapMode", value);
      }));
    new Setting(containerEl)
      .setName("Default heatmap metric")
      .setDesc("Switch between added words, characters, and lines. Removed amounts remain visible in each day’s detail.")
      .addDropdown((dropdown) => dropdown
        .addOption("words", "Words added")
        .addOption("characters", "Characters added")
        .addOption("lines", "Lines added")
        .setValue(this.plugin.settings.heatmapMetric)
        .onChange((value) => {
          if (value === "words" || value === "characters" || value === "lines") return this.save("heatmapMetric", value);
        }));
    new Setting(containerEl)
      .setName("Dashboard layout")
      .setDesc("Choose, hide, and reorder dashboard sections from the dashboard itself.")
      .addButton((button) => button.setButtonText("Customize").onClick(() => void this.plugin.openDashboardCustomizer()));

    new Setting(containerEl).setName("Productivity pet").setHeading();
    new Setting(containerEl)
      .setName("Enable pet check-ins")
      .setDesc("Let your pet occasionally offer a small prompt or encouraging thought.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.petEnabled).onChange((value) => this.save("petEnabled", value)));
    new Setting(containerEl)
      .setName("Pet name")
      .addText((text) => text.setPlaceholder("Pip").setValue(this.plugin.settings.petName).onChange((value) => this.save("petName", value.trim() || "Pip")));
    new Setting(containerEl)
      .setName("Check-in frequency")
      .setDesc("Minutes between pet check-ins. Takes effect after reloading the plugin.")
      .addSlider((slider) => slider.setLimits(30, 240, 15).setValue(this.plugin.settings.petCheckInMinutes).onChange((value) => this.save("petCheckInMinutes", value)));
    new Setting(containerEl)
      .setName("Pet quotes")
      .setDesc("One message per line. The pet chooses one at random.")
      .addTextArea((area) => area
        .setValue(this.plugin.settings.quotes.join("\n"))
        .onChange((value) => this.save("quotes", value.split("\n").map((line) => line.trim()).filter(Boolean))));

    const templateReference = containerEl.createEl("details", { cls: "prodlife-settings-details" });
    templateReference.createEl("summary", { text: "Template reference" });
    templateReference.createEl("p", { text: "Use these only when building templates by hand." });
    const reference = templateReference.createEl("pre");
    reference.createEl("code", { text: "{{date}}  {{time}}  {{title}}  {{previous_note}}  {{rollover}}\n{{schedule * * 1-5}}\n- [ ] Runs Monday to Friday" });
  }

  private async save<Key extends keyof ProdLifePlugin["settings"]>(key: Key, value: ProdLifePlugin["settings"][Key]): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings(key === "defaultReminderTime" || key === "reminderFolders");
  }

  private async saveList(key: "reminderFolders" | "writingFolders", value: string, invalidateReminders = false): Promise<void> {
    this.plugin.settings[key] = value.split(",").map((path) => path.trim()).filter(Boolean);
    await this.plugin.saveSettings(invalidateReminders);
  }
}

const validTime = (value: string): string | undefined => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? undefined : "Use a 24-hour time such as 09:00.";
};

class TemplateTaskModal extends Modal {
  private target = "default";
  private title = "";
  private time = "09:00";
  private allDay = false;

  constructor(app: App, private plugin: ProdLifePlugin) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Add task to daily template" });
    new Setting(this.contentEl).setName("Template").addDropdown((dropdown) => {
      dropdown.addOption("default", "Default");
      DAYS.forEach((day, index) => { dropdown.addOption(String(index), day); });
      dropdown.onChange((value) => { this.target = value; });
    });
    new Setting(this.contentEl).setName("Task").addText((text) => text.setPlaceholder("Send invoices").onChange((value) => { this.title = value; }));
    new Setting(this.contentEl).setName("Time").addText((text) => {
      text.inputEl.type = "time";
      text.setValue(this.time).onChange((value) => { this.time = value; });
    });
    new Setting(this.contentEl).setName("All day").addToggle((toggle) => toggle.onChange((value) => { this.allDay = value; }));
    new Setting(this.contentEl).addButton((button) => button.setCta().setButtonText("Add task").onClick(() => {
      if (!this.title.trim()) {
        new Notice("Enter a task name.");
        return;
      }
      void this.plugin.addTemplateTask(this.target, this.title, this.time, this.allDay).then((added) => { if (added) this.close(); });
    }));
  }
}
