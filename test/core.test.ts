import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  activityFromContent,
  achievementsFor,
  calculateStreak,
  countWords,
  ensureDailyFrontmatter,
  extractRollover,
  parseLocalDate,
  parseReminders,
  persistentWordTotal,
  renderTemplate,
  scheduleMatches,
  shouldArchiveDaily,
  upsertReminder
} from "../src/core";

test("parses supported reminder formats and ignores completed tasks", () => {
  const content = [
    "- [ ] Call Sam (@2026-07-10 14:30)",
    "- [ ] Ship it @{2026-07-11}",
    "- [ ] Tasks format ⏰ 2026-07-12 08:15",
    "- [x] Already done 📅 2026-07-13"
  ].join("\n");
  const reminders = parseReminders(content, "Daily/2026-07-10.md");
  assert.equal(reminders.length, 4);
  assert.equal(reminders[0]?.text, "Call Sam");
  assert.equal(reminders[2]?.rawDue, "2026-07-12 08:15");
  assert.equal(reminders[3]?.completed, true);
  assert.equal(reminders[0]?.allDay, false);
  assert.equal(reminders[1]?.allDay, true);
  assert.equal(reminders[0]?.key, parseReminders(`Intro\n${content}`, "Daily/2026-07-10.md")[0]?.key);
});

test("preserves the vault's bold reminder titles and wikilinks", () => {
  const reminders = parseReminders([
    "- [ ] **P01958 (Switchshop)** (@2026-07-12 09:00)",
    "- [ ] **EOD** | [[Templates/EOD]] (@[[2026-07-17]] 17:00)"
  ].join("\n"), "FTL/Pending CTCU.md");
  assert.equal(reminders[0]?.text, "**P01958 (Switchshop)**");
  assert.equal(reminders[1]?.text, "**EOD** | [[Templates/EOD]]");
  assert.equal(reminders[1]?.allDay, false);
});

test("rejects impossible local dates", () => {
  assert.equal(parseLocalDate("2026-02-30"), null);
  assert.equal(parseLocalDate("2026-07-10 25:00"), null);
  assert.notEqual(parseLocalDate("2026-07-10"), null);
  assert.notEqual(parseLocalDate("[[Daily/10-07-2026|2026-07-10]] 09:00"), null);
});

test("rolls open tasks forward with their hierarchy", () => {
  const result = extractRollover([
    "---", "tag: daily", "---", "# Work",
    "- [x] Finished", "- [x] Parent", "  - [ ] Open child",
    "# Empty", "Some journal text", "# Personal", "- [ ] Walk"
  ].join("\n"));
  assert.equal(result, "# Work\n- [x] Parent\n  - [ ] Open child\n# Personal\n- [ ] Walk");
});

test("renders weekday schedules and template variables", () => {
  const monday = new Date(2026, 6, 6, 8, 5);
  const output = renderTemplate("# {{title}}\n{{schedule * * 1-5}}\n- [ ] Weekday review\n## Notes", monday, "2026-07-06", "Daily/prev");
  assert.equal(output, "# 2026-07-06\n- [ ] Weekday review\n## Notes");
  assert.equal(scheduleMatches("{{obligate * * 0}}", monday), false);
});

test("renders formatted Daily Notes variables", () => {
  const date = new Date(2026, 6, 10, 8, 5);
  const output = renderTemplate("{{date:YYYY/MM/DD}} {{time:HH:mm}} {{daily-five}}", date, "title");
  assert.equal(output, "2026/07/10 08:05 {{daily-five}}");
});

test("adds and updates linked reminders", () => {
  assert.equal(upsertReminder("- [ ] Call Sam", "2026-07-12", "09:30"), "- [ ] Call Sam (@[[2026-07-12]] 09:30)");
  assert.equal(upsertReminder("- [ ] Call Sam (@2026-07-11)", "2026-07-12", ""), "- [ ] Call Sam (@[[2026-07-12]])");
  assert.equal(upsertReminder("- [ ] Call Sam @{2026-07-11}", "2026-07-12", "09:30"), "- [ ] Call Sam (@[[2026-07-12]] 09:30)");
  assert.equal(upsertReminder("- [ ] Call Sam ⏰ 2026-07-11 08:00", "2026-07-12", "09:30"), "- [ ] Call Sam (@[[2026-07-12]] 09:30)");
  assert.equal(upsertReminder("- [ ] Call Sam", "2026-07-12", "09:30", true, "Daily/12-07-2026"), "- [ ] Call Sam (@[[Daily/12-07-2026|2026-07-12]] 09:30)");
});

test("merges ProdLife fields into existing template frontmatter", () => {
  const result = ensureDailyFrontmatter("---\ntags:\n  - daily\n---\n## Today", "2026-07-10");
  assert.equal(result, "---\ntags:\n  - daily\nprodlife: true\ndate: 2026-07-10\n---\n## Today");
});

test("calculates activity and a consecutive streak", () => {
  const first = activityFromContent("2026-07-09", "- [x] A\n- [ ] B\n- [ ] ");
  const second = activityFromContent("2026-07-10", "- [x] C");
  assert.deepEqual(first, { date: "2026-07-09", completed: 1, total: 2 });
  assert.equal(calculateStreak([first, second], new Date(2026, 6, 10)), 2);
  assert.equal(calculateStreak([first], new Date(2026, 6, 10)), 1);
});

test("does not roll an untouched task placeholder", () => {
  assert.equal(extractRollover("# Focus\n- [ ] \n# Work\n- [ ] Real task"), "# Work\n- [ ] Real task");
});

test("counts words and never subtracts persistent writing history", () => {
  assert.equal(countWords("Hello, productive world. Καλημέρα 世界"), 6);
  assert.equal(persistentWordTotal(120, 20, 35), 135);
  assert.equal(persistentWordTotal(135, 35, 0), 135);
});

test("builds a broad achievement catalog with progress and unlock dates", () => {
  const activity = [{ date: "2026-07-11", completed: 10, total: 10 }];
  const achievements = achievementsFor(activity, 3, { "2026-07-11": 600 }, { "tasks-1": 1234 });
  assert.ok(achievements.length >= 40);
  assert.equal(achievements.find((item) => item.id === "tasks-1")?.unlockedAt, 1234);
  assert.equal(achievements.find((item) => item.id === "tasks-1")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "words-500")?.unlocked, true);
});

test("archives only daily notes old enough for the configured policy", () => {
  const today = new Date(2026, 6, 11);
  assert.equal(shouldArchiveDaily("2026-07-10", today, 1), true);
  assert.equal(shouldArchiveDaily("2026-07-10", today, 2), false);
  assert.equal(shouldArchiveDaily("not-a-date", today, 1), false);
});
