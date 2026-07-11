# Changelog

All notable changes to ProdLife are documented here.

## 1.1.0 - 2026-07-11

### Added

- Compact date-grouped reminder sidebar based on Reminder's proven layout.
- Obsidian Markdown rendering for reminder titles and wikilinks across the dashboard, sidebar, and notification UI.
- Full calendar reminder editor with month navigation, time selection, quick Today action, and all-day tasks.
- Default and weekday templates on one settings row plus a guided daily-template task builder.
- Automatic daily-note archiving the next day or after a configurable retention period.
- Append-only word tracking with first-run backfill, per-file baselines, folder scope, and deletion-proof history.
- Responsive month/year writing heatmaps with date navigation and no horizontal scrollbar.
- User-controlled dashboard section visibility and ordering.
- Forty-eight achievements across tasks, writing, streaks, and consistency with progress, unlock dates, collection UI, and unlock popups.
- Configurable sync-safe startup delay before reminders and automatic archiving run.
- Pixel-art Pip character and speech-bubble check-ins.

### Changed

- Dashboard surfaces, spacing, typography, interactions, and responsive behavior were redesigned around a lighter editorial hierarchy.
- Minimum supported Obsidian version is now 1.10.0 for the current Markdown rendering API.

## 1.0.1 - 2026-07-10

### Fixed

- Removed unsafe array and Moment inference reported by the Obsidian review scanner and added the reviewer-equivalent type-aware lint rules to CI.
- Preserved existing template frontmatter instead of creating a second frontmatter block.
- Added formatted Daily Notes variables such as `{{date:YYYY-MM-DD}}` and `{{time:HH:mm}}`.

### Added

- One-click import of compatible Daily Notes and Reminder settings on first run or by command.
- Linked reminder editor in the command palette and editor context menu.
- Configurable vault-wide or folder-scoped reminder scanning.
- Configurable snooze choices with migration from Reminder's existing choices.
- Previous/next navigation updates as new daily notes are created.
- Daily Five migration guidance while preserving its template placeholder.

## 1.0.0 - 2026-07-10

### Added

- Daily notes with configurable paths, nested date formats, built-in fallback template, and templates per weekday.
- Template macros for date, time, title, previous note, task rollover, and cron-like scheduled tasks.
- Hierarchical rollover that preserves headings and unfinished descendants without copying finished work.
- Reminder scanning for ProdLife/Reminder, Kanban, and Obsidian Tasks syntax.
- Actionable reminders with complete, open, 15-minute, one-hour, and next-day actions.
- Productivity dashboard with a 365-day heatmap, task totals, streaks, and six achievements.
- Productivity pet with manual and optional periodic check-ins.
- Manual daily-note archiving, mobile support, and automatic GitHub release packaging.
