# ProdLife

ProdLife turns Obsidian into one coherent daily productivity system. It replaces the built-in Daily notes workflow, rolls unfinished work forward without flattening its structure, handles reminders in the formats you already use, and makes progress visible through streaks, achievements, and a GitHub-style heatmap.

Everything stays local in your vault. ProdLife has no account, analytics, network requests, or paid service.

## Features

- **A complete daily-note workflow:** open or create today from the ribbon or command palette, using nested date paths and a built-in fallback template.
- **Templates for different days:** use a default template plus optional overrides for every weekday.
- **Intelligent rollover:** carry open tasks, nested tasks, and their surrounding headings from the most recent daily note. Completed branches disappear; checked parents remain when they still contain unfinished children.
- **Recurring tasks:** include a task only when its compact schedule matches the new note's date.
- **Reminders:** scan the entire vault, notify when a task is due, then complete, open, or snooze it directly.
- **Reminder sidebar:** review reminders in a compact date-grouped right panel with rendered Markdown, linked notes, all-day labels, and source files.
- **Reminder editor:** use the command palette or editor context menu to choose a date from a calendar, set a time, or mark the task all day.
- **A configurable dashboard:** show, hide, and reorder daily focus, metrics, writing heatmap, achievements, and reminders.
- **Persistent writing history:** log positive word-count changes permanently, including a first-run backlog. Later edits or deleted notes never erase earned activity.
- **A real achievement collection:** work through 48 task, writing, streak, and consistency milestones with progress, completion dates, and unlock popups.
- **A productivity pet:** Pip appears beside the dashboard and in a lightweight speech popup with configurable check-ins.
- **Automatic archiving:** archive manually, the next day, or after a chosen number of days without breaking task rollover.
- **Desktop and mobile:** uses only Obsidian APIs and browser APIs.

## Install

### Community plugins

Once ProdLife is accepted into the Obsidian Community directory:

1. Open **Settings → Community plugins**.
2. Select **Browse**, search for **ProdLife**, and install it.
3. Enable ProdLife, then disable the core Daily notes plugin if you want ProdLife to be the only daily-note handler.

### Manual or BRAT installation

Download `main.js`, `manifest.json`, and `styles.css` from a matching GitHub release and place them in:

```text
<your-vault>/.obsidian/plugins/prodlife/
```

Reload Obsidian and enable ProdLife under Community plugins. BRAT users can add `0libote/ProdLife`.

## Start here

1. Run **ProdLife: Open today's note**. ProdLife creates `Daily/YYYY-MM-DD.md` with its built-in template.
2. Open **Settings → ProdLife** to choose a daily folder, date format, and templates.
3. Run **ProdLife: Open dashboard** to see progress and upcoming reminders.
4. Use the sprout, alarm-clock, and calendar-check ribbon icons for quick access.

If you already use Daily Notes and Reminder, run **ProdLife: Import Daily Notes and Reminder settings** before changing either plugin. ProdLife imports their compatible settings without modifying any notes.

## Reminder syntax

ProdLife understands four common formats on Markdown tasks:

```markdown
- [ ] Send the proposal (@2026-07-12 14:30)
- [ ] Review the release @{2026-07-13}
- [ ] Book the train ⏰ 2026-07-14 09:00
- [ ] Pay the invoice 📅 2026-07-15
```

A date without a time uses the **Default reminder time** setting. `📆` and `🗓` work like `📅`. Checked tasks do not notify. Obsidian cannot provide system notifications on every mobile platform, so ProdLife shows reminders inside the app.

Use **Set reminder on current line** to open ProdLife's calendar. Choose a day, optionally set a time, or enable **All day**. Reminder checks wait for the configurable startup delay so Obsidian Sync and third-party sync tools can settle first.

## Templates

Available variables:

| Variable | Result |
| --- | --- |
| `{{date}}` | ISO date, such as `2026-07-10` |
| `{{time}}` | Current local time |
| `{{title}}` | Daily note title using your date format |
| `{{previous_note}}` | Vault path to the previous daily note |
| `{{rollover}}` | Insert rolled tasks at this exact location |

Formatted Daily Notes variables are also supported, including `{{date:YYYY-MM-DD}}`, `{{date:dddd, D MMMM}}`, and `{{time:HH:mm}}`. Unknown placeholders such as `{{daily-five}}` are preserved for the plugin that owns them.

Without `{{rollover}}`, carried work appears under a **Rolled forward** heading at the end of the template.

The settings page also includes an **Add task** builder beside the default and weekday template controls. It writes the correct `{{date:YYYY-MM-DD}}` formula for you, so ordinary template setup does not require memorizing syntax.

### Recurring tasks

Put a schedule macro immediately before the line it controls:

```markdown
{{schedule * * 1-5}}
- [ ] Weekday planning

{{schedule 1 1,4,7,10 *}}
- [ ] Quarterly review
```

The three fields are **day of month**, **month**, and **day of week** (`0` is Sunday). Each accepts `*`, comma-separated values, or ranges. The legacy `{{obligate ...}}` spelling is also supported for easy migration from Obligator.

## Commands

- **Open today's note**
- **Open dashboard**
- **Open reminder sidebar**
- **Scan reminders now**
- **Set reminder on current line**
- **Import Daily Notes and Reminder settings**
- **Archive old daily notes**
- **Ask your productivity pet**

Archiving never overwrites an existing file. Files with a destination conflict remain in the daily folder.

## Writing heatmap and achievements

ProdLife records words added to Markdown files rather than recalculating the current size of a note. Reducing a note or deleting it does not subtract historical words. On first run, existing notes are backfilled using daily-note dates when available and file modification dates otherwise.

The heatmap supports month and year views with previous/next navigation and scales to its container without a horizontal scrollbar. Set a daily word goal to control intensity. Restrict tracking with **Writing folders**, or leave it blank for the whole vault.

Select the dashboard layout button beside the ProdLife wordmark to show, hide, reset, or reorder sections. Select the achievement counter to open the full collection with category, progress, target, and unlock date.

## Migrating

### From Daily notes

Run **Import Daily Notes and Reminder settings**, verify the imported folder, format, and template, then open today's note through ProdLife. Existing notes and template frontmatter are preserved. ProdLife understands the core plugin's formatted date/time variables.

If you use Daily Five, it currently reads the core Daily Notes configuration. Either leave the core plugin enabled while using ProdLife's commands, or set Daily Five's **Fallback Daily Note folder** and date format to the same values before disabling Daily Notes. This keeps `{{daily-five}}` insertion working.

### From Reminder

Existing `(@date)`, linked `(@[[date]])`, Kanban, and Obsidian Tasks reminders continue to work. The import command carries over the default time, linked-date mode, scan interval, and snooze choices. Confirm the ProdLife reminder list before disabling Reminder to prevent missed or duplicate alerts.

### From Obligator

ProdLife supports `{{obligate ...}}`, structured task rollover, previous-note links, nested date formats, empty-heading cleanup, and manual archiving. Select your former Obligator template and note folder in ProdLife settings.

## Privacy and safety

ProdLife enumerates Markdown files because vault-wide Reminder compatibility and optional whole-vault writing history require finding activity outside the daily folder. You can restrict these separately under **Reminder folders** and **Writing folders**; for example, `Daily, FTL`. Persistent history stores dates and aggregate word totals plus current per-file baselines in ProdLife's local plugin data. ProdLife writes notes only when creating a daily note, adding or completing a reminder, linking adjacent daily notes, or archiving. There is no telemetry or external communication.

Before adopting any new workflow plugin, back up or version-control your vault. ProdLife uses Obsidian's vault and file-manager APIs so changes participate in normal Obsidian file handling.

## Development and release

```bash
npm ci
npm run check
```

`npm run check` runs unit tests, Obsidian-specific lint rules, TypeScript checks, and the production build. To release, run `npm version patch|minor|major` and push the generated version commit and exact numeric tag. GitHub Actions builds and prepares a draft release containing the three Marketplace assets.

## Credits

ProdLife builds on ideas pioneered by [Obsidian Reminder](https://github.com/uphy/obsidian-reminder), [Obligator](https://github.com/Newbrict/obsidian-obligator), [Daily Writing Stats](https://github.com/xsixteen/obsidian-daily-heatmap), and [Keep the Rhythm](https://github.com/benjaminezequiel/keep-the-rhythm). Attribution and license details are in [NOTICE.md](NOTICE.md).

## License

[MIT](LICENSE)
