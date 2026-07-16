import assert from "node:assert/strict";
import { mock, test } from "bun:test";

class MockTFile {
  extension = "md";
  constructor(public path = "") {}
}

mock.module("obsidian", () => ({
  App: class {},
  Component: class {},
  Editor: class {},
  MarkdownRenderer: { render: async () => {} },
  MarkdownView: class {},
  Modal: class {},
  Notice: class {},
  TFile: MockTFile,
  TFolder: class {},
  normalizePath: (path: string) => path,
  setIcon: () => {}
}));

test("tracks pasted and replaced writing as added and removed metrics", async () => {
  const { diffWriting } = await import("../src/writing");
  assert.deepEqual(diffWriting("Hello world", "Hello world wide\nAgain"), {
    wordsAdded: 2,
    wordsRemoved: 0,
    charactersAdded: 11,
    charactersRemoved: 0,
    linesAdded: 1,
    linesRemoved: 0
  });
  assert.deepEqual(diffWriting("Keep red pen", "Keep blue pen"), {
    wordsAdded: 1,
    wordsRemoved: 1,
    charactersAdded: 4,
    charactersRemoved: 3,
    linesAdded: 0,
    linesRemoved: 0
  });
});

test("merges cross-device writing counters without double counting", async () => {
  const { mergeWritingHistory, summarizeWritingDay } = await import("../src/writing");
  const local = {
    "2026-07-16": {
      words: 10,
      updatedAt: 1,
      devices: { laptop: { wordsAdded: 10, wordsRemoved: 1, charactersAdded: 50, charactersRemoved: 5, linesAdded: 2, linesRemoved: 0, updatedAt: 1 } }
    }
  };
  const incoming = {
    "2026-07-16": {
      words: 15,
      updatedAt: 2,
      devices: {
        laptop: { wordsAdded: 12, wordsRemoved: 1, charactersAdded: 60, charactersRemoved: 5, linesAdded: 2, linesRemoved: 0, updatedAt: 2 },
        phone: { wordsAdded: 3, wordsRemoved: 0, charactersAdded: 18, charactersRemoved: 0, linesAdded: 1, linesRemoved: 0, updatedAt: 2 }
      }
    }
  };
  const merged = mergeWritingHistory(local, incoming);
  assert.equal(merged["2026-07-16"]?.words, 15);
  assert.deepEqual(summarizeWritingDay(merged["2026-07-16"]), {
    wordsAdded: 15,
    wordsRemoved: 1,
    charactersAdded: 78,
    charactersRemoved: 5,
    linesAdded: 3,
    linesRemoved: 0
  });
});

test("rescans only the reminder file that changed", async () => {
  const { ReminderService } = await import("../src/reminders");
  const { DEFAULT_SETTINGS } = await import("../src/types");
  const first = new MockTFile("First.md");
  const second = new MockTFile("Second.md");
  const files = new Map([[first.path, first], [second.path, second]]);
  const contents = new Map([
    [first.path, "- [ ] First (@2026-07-18 09:00)"],
    [second.path, "- [ ] Second (@2026-07-19 09:00)"]
  ]);
  let reads = 0;
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: MockTFile) => {
        reads++;
        return contents.get(file.path) ?? "";
      }
    }
  };
  const data = {
    completedReminders: {},
    snoozedUntil: {},
    notified: {}
  };
  const reminders = new ReminderService(
    app as never,
    () => DEFAULT_SETTINGS,
    () => data as never,
    async () => {},
    {} as never,
    (date) => date
  );

  assert.equal((await reminders.scan()).length, 2);
  assert.equal(reads, 2);
  assert.equal((await reminders.scan()).length, 2);
  assert.equal(reads, 2);

  contents.set(first.path, "- [ ] Updated (@2026-07-20 09:00)");
  reminders.invalidate(first.path);
  const result = await reminders.scan();
  assert.equal(reads, 3);
  assert.equal(result.find((item) => item.path === first.path)?.text, "Updated");
});
