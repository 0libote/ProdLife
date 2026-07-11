import { App, Modal, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import type ProdLifePlugin from "./main";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export class ProdLifeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ProdLifePlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", { text: "One system for daily notes, reminders, and sustainable momentum." });

    new Setting(containerEl)
      .setName("Import your current workflow")
      .setDesc("Copies the core Daily Notes folder, format, and template plus Reminder's default time, linked-date preference, interval, and snooze options into ProdLife. Your notes are not changed.")
      .addButton((button) => button.setButtonText("Import settings").onClick(() => void this.plugin.importLegacySettings()));
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Daily Five compatibility: before disabling the core Daily Notes plugin, set Daily Five’s fallback folder and date format to the same values shown below. You may also leave the core plugin enabled and simply use ProdLife’s commands."
    });

    new Setting(containerEl).setName("Daily notes").setHeading();
    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder where ProdLife creates daily notes. Nested date formats are supported.")
      .addText((text) => text.setPlaceholder("Daily").setValue(this.plugin.settings.dailyFolder).onChange((value) => this.save("dailyFolder", value.trim())));
    new Setting(containerEl)
      .setName("Date format")
      .setDesc("Moment.js format used for note names, for example YYYY-MM-DD or YYYY/MM/YYYY-MM-DD.")
      .addText((text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dateFormat).onChange((value) => this.save("dateFormat", value.trim() || "YYYY-MM-DD")));
    let weekdayTemplate: TextComponent | null = null;
    let selectedDay = String(new Date().getDay());
    new Setting(containerEl)
      .setName("Daily note templates")
      .setDesc("Default template, weekday picker, and that weekday’s override. Leave an override blank to use the default.")
      .addText((text) => {
        text.inputEl.setAttr("aria-label", "Default daily note template");
        text.setPlaceholder("Default template").setValue(this.plugin.settings.defaultTemplate).onChange((value) => this.save("defaultTemplate", value.trim()));
      })
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
      })
      .addButton((button) => button.setButtonText("Add task").setTooltip("Add a dated task without writing template formulas").onClick(() => new TemplateTaskModal(this.app, this.plugin).open()));
    new Setting(containerEl)
      .setName("Roll unfinished tasks forward")
      .setDesc("Preserve open tasks, nested children, and their headings from the previous daily note.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.rolloverTasks).onChange((value) => this.save("rolloverTasks", value)));
    new Setting(containerEl)
      .setName("Remove empty headings")
      .setDesc("Do not carry headings that contain no unfinished tasks into the next note.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.removeEmptyHeadings).onChange((value) => this.save("removeEmptyHeadings", value)));
    let archiveDays: TextComponent | null = null;
    new Setting(containerEl)
      .setName("Archive folder")
      .setDesc("Archive destination, automatic schedule, and retention age.")
      .addText((text) => text.setPlaceholder("Archive/Daily").setValue(this.plugin.settings.archiveFolder).onChange((value) => this.save("archiveFolder", value.trim())))
      .addDropdown((dropdown) => dropdown
        .addOption("off", "Manual")
        .addOption("next-day", "Next day")
        .addOption("after-days", "After days")
        .setValue(this.plugin.settings.autoArchiveMode)
        .onChange((value) => {
          if (value !== "off" && value !== "next-day" && value !== "after-days") return;
          archiveDays?.setDisabled(value !== "after-days");
          void this.save("autoArchiveMode", value);
        }))
      .addText((text) => {
        archiveDays = text;
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.setAttr("aria-label", "Days before automatic archive");
        text.setPlaceholder("Days").setValue(String(this.plugin.settings.autoArchiveDays)).setDisabled(this.plugin.settings.autoArchiveMode !== "after-days").onChange((value) => {
          const days = Number(value);
          if (Number.isInteger(days) && days > 0) void this.save("autoArchiveDays", days);
        });
      });

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
      .setDesc("New reminders use linked dates such as (@[[2026-07-12]] 09:30), matching Reminder's linked-date mode.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.linkReminderDates).onChange((value) => this.save("linkReminderDates", value)));
    new Setting(containerEl)
      .setName("Reminder folders")
      .setDesc("Comma-separated folders or files to scan. Leave blank to scan Markdown files across the vault, which matches Reminder's behavior.")
      .addText((text) => text
        .setPlaceholder("Daily, FTL")
        .setValue(this.plugin.settings.reminderFolders.join(", "))
        .onChange((value) => this.save("reminderFolders", value.split(",").map((path) => path.trim()).filter(Boolean))));
    new Setting(containerEl)
      .setName("Snooze options")
      .setDesc("Comma-separated delay choices in minutes. 1440 is one day and 10080 is one week.")
      .addText((text) => text
        .setPlaceholder("30, 60, 180, 1440, 10080")
        .setValue(this.plugin.settings.snoozeMinutes.join(", "))
        .onChange((value) => {
          const minutes = value.split(",").map(Number).filter((item) => Number.isFinite(item) && item > 0);
          if (minutes.length) void this.save("snoozeMinutes", minutes);
        }));
    new Setting(containerEl)
      .setName("Scan interval")
      .setDesc("Seconds between reminder checks. Takes effect after reloading the plugin.")
      .addSlider((slider) => slider.setLimits(15, 300, 15).setValue(this.plugin.settings.reminderIntervalSeconds).onChange((value) => this.save("reminderIntervalSeconds", value)));
    new Setting(containerEl)
      .setName("Startup delay")
      .setDesc("Wait for Obsidian Sync or another sync plugin before showing overdue reminders and auto-archiving.")
      .addSlider((slider) => slider.setLimits(5, 120, 5).setValue(this.plugin.settings.startupDelaySeconds).onChange((value) => this.save("startupDelaySeconds", value)));

    new Setting(containerEl).setName("Dashboard and writing").setHeading();
    new Setting(containerEl)
      .setName("Writing folders")
      .setDesc("Comma-separated files or folders for persistent word tracking. Leave blank for the whole vault.")
      .addText((text) => text.setPlaceholder("Daily, Notes").setValue(this.plugin.settings.writingFolders.join(", ")).onChange((value) => this.save("writingFolders", value.split(",").map((path) => path.trim()).filter(Boolean))));
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

    new Setting(containerEl).setName("Template reference").setHeading();
    const reference = containerEl.createEl("pre");
    reference.createEl("code", { text: "{{date}}  {{time}}  {{title}}  {{previous_note}}  {{rollover}}\n{{schedule * * 1-5}}\n- [ ] Runs Monday to Friday" });
  }

  private async save<Key extends keyof ProdLifePlugin["settings"]>(key: Key, value: ProdLifePlugin["settings"][Key]): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }
}

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
