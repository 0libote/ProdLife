import assert from "node:assert/strict";
import test from "node:test";
import {
  activityFromContent,
  calculateStreak,
  ensureDailyFrontmatter,
  extractRollover,
  parseLocalDate,
  parseReminders,
  renderTemplate,
  scheduleMatches,
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
});

test("rejects impossible local dates", () => {
  assert.equal(parseLocalDate("2026-02-30"), null);
  assert.equal(parseLocalDate("2026-07-10 25:00"), null);
  assert.notEqual(parseLocalDate("2026-07-10"), null);
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
  const output = renderTemplate("# {{title}}\n{{schedule * * 1-5}}\n- [ ] Weekday review", monday, "2026-07-06", "Daily/prev");
  assert.equal(output, "# 2026-07-06\n- [ ] Weekday review");
  assert.equal(scheduleMatches("{{obligate * * 0}}", monday), false);
});

test("renders formatted Daily Notes variables", () => {
  const date = new Date(2026, 6, 10, 8, 5);
  const output = renderTemplate("{{date:YYYY/MM/DD}} {{time:HH:mm}}", date, "title");
  assert.equal(output, "2026/07/10 08:05");
});

test("adds and updates linked reminders", () => {
  assert.equal(upsertReminder("- [ ] Call Sam", "2026-07-12", "09:30"), "- [ ] Call Sam (@[[2026-07-12]] 09:30)");
  assert.equal(upsertReminder("- [ ] Call Sam (@2026-07-11)", "2026-07-12", ""), "- [ ] Call Sam (@[[2026-07-12]])");
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
});

test("does not roll an untouched task placeholder", () => {
  assert.equal(extractRollover("# Focus\n- [ ] \n# Work\n- [ ] Real task"), "# Work\n- [ ] Real task");
});
