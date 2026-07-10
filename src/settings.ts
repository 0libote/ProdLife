import { App, PluginSettingTab, Setting } from "obsidian";
import type ProdLifePlugin from "./main";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export class ProdLifeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ProdLifePlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h1", { text: "ProdLife" });
    containerEl.createEl("p", { text: "One system for daily notes, reminders, and sustainable momentum." });

    containerEl.createEl("h2", { text: "Daily notes" });
    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder where ProdLife creates daily notes. Nested date formats are supported.")
      .addText((text) => text.setPlaceholder("Daily").setValue(this.plugin.settings.dailyFolder).onChange((value) => this.save("dailyFolder", value.trim())));
    new Setting(containerEl)
      .setName("Date format")
      .setDesc("Moment.js format used for note names, for example YYYY-MM-DD or YYYY/MM/YYYY-MM-DD.")
      .addText((text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dateFormat).onChange((value) => this.save("dateFormat", value.trim() || "YYYY-MM-DD")));
    new Setting(containerEl)
      .setName("Default template")
      .setDesc("Vault path to a template note, without or with .md. Leave blank for the built-in template.")
      .addText((text) => text.setPlaceholder("Templates/Daily").setValue(this.plugin.settings.defaultTemplate).onChange((value) => this.save("defaultTemplate", value.trim())));
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
      .setDesc("Optional destination used by the Archive old daily notes command.")
      .addText((text) => text.setPlaceholder("Archive/Daily").setValue(this.plugin.settings.archiveFolder).onChange((value) => this.save("archiveFolder", value.trim())));

    containerEl.createEl("h3", { text: "Templates by weekday" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "A weekday template overrides the default template on that day." });
    DAYS.forEach((day, index) => {
      new Setting(containerEl)
        .setName(day)
        .addText((text) => text
          .setPlaceholder("Use default")
          .setValue(this.plugin.settings.weekdayTemplates[String(index)] ?? "")
          .onChange(async (value) => {
            this.plugin.settings.weekdayTemplates[String(index)] = value.trim();
            await this.plugin.saveSettings();
          }));
    });

    containerEl.createEl("h2", { text: "Reminders" });
    new Setting(containerEl)
      .setName("Enable reminders")
      .setDesc("Check the vault for due reminders and show actionable notifications inside Obsidian.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.remindersEnabled).onChange((value) => this.save("remindersEnabled", value)));
    new Setting(containerEl)
      .setName("Default reminder time")
      .setDesc("Time used for reminders that specify a date without a time.")
      .addText((text) => text.setPlaceholder("09:00").setValue(this.plugin.settings.defaultReminderTime).onChange((value) => this.save("defaultReminderTime", /^\d{1,2}:\d{2}$/.test(value) ? value : "09:00")));
    new Setting(containerEl)
      .setName("Scan interval")
      .setDesc("Seconds between reminder checks. Takes effect after reloading the plugin.")
      .addSlider((slider) => slider.setLimits(15, 300, 15).setDynamicTooltip().setValue(this.plugin.settings.reminderIntervalSeconds).onChange((value) => this.save("reminderIntervalSeconds", value)));

    containerEl.createEl("h2", { text: "Productivity pet" });
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
      .addSlider((slider) => slider.setLimits(30, 240, 15).setDynamicTooltip().setValue(this.plugin.settings.petCheckInMinutes).onChange((value) => this.save("petCheckInMinutes", value)));
    new Setting(containerEl)
      .setName("Pet quotes")
      .setDesc("One message per line. The pet chooses one at random.")
      .addTextArea((area) => area
        .setValue(this.plugin.settings.quotes.join("\n"))
        .onChange((value) => this.save("quotes", value.split("\n").map((line) => line.trim()).filter(Boolean))));

    containerEl.createEl("h2", { text: "Template reference" });
    const reference = containerEl.createEl("pre");
    reference.createEl("code", { text: "{{date}}  {{time}}  {{title}}  {{previous_note}}  {{rollover}}\n{{schedule * * 1-5}}\n- [ ] Runs Monday to Friday" });
  }

  private async save<Key extends keyof ProdLifePlugin["settings"]>(key: Key, value: ProdLifePlugin["settings"][Key]): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }
}
