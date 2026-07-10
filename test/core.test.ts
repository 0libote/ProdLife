import assert from "node:assert/strict";
import test from "node:test";
import {
  activityFromContent,
  calculateStreak,
  extractRollover,
  parseLocalDate,
  parseReminders,
  renderTemplate,
  scheduleMatches
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

test("calculates activity and a consecutive streak", () => {
  const first = activityFromContent("2026-07-09", "- [x] A\n- [ ] B");
  const second = activityFromContent("2026-07-10", "- [x] C");
  assert.deepEqual(first, { date: "2026-07-09", completed: 1, total: 2 });
  assert.equal(calculateStreak([first, second], new Date(2026, 6, 10)), 2);
});
