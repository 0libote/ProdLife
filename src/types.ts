export interface ProdLifeSettings {
  dailyFolder: string;
  dateFormat: string;
  defaultTemplate: string;
  weekdayTemplates: Record<string, string>;
  rolloverTasks: boolean;
  removeEmptyHeadings: boolean;
  archiveFolder: string;
  autoArchiveMode: "off" | "next-day" | "after-days";
  autoArchiveDays: number;
  reminderIntervalSeconds: number;
  defaultReminderTime: string;
  linkReminderDates: boolean;
  reminderFolders: string[];
  remindersEnabled: boolean;
  snoozeMinutes: number[];
  startupDelaySeconds: number;
  dashboardSections: DashboardSectionId[];
  heatmapMode: "year" | "month";
  heatmapMetric: WritingMetric;
  writingGoal: number;
  writingFolders: string[];
  petEnabled: boolean;
  petName: string;
  petCheckInMinutes: number;
  quotes: string[];
}

export const DEFAULT_SETTINGS: ProdLifeSettings = {
  dailyFolder: "Daily",
  dateFormat: "YYYY-MM-DD",
  defaultTemplate: "",
  weekdayTemplates: {},
  rolloverTasks: true,
  removeEmptyHeadings: true,
  archiveFolder: "",
  autoArchiveMode: "off",
  autoArchiveDays: 7,
  reminderIntervalSeconds: 30,
  defaultReminderTime: "09:00",
  linkReminderDates: true,
  reminderFolders: [],
  remindersEnabled: true,
  snoozeMinutes: [30, 60, 180, 1440, 10080],
  startupDelaySeconds: 30,
  dashboardSections: ["hero", "metrics", "heatmap", "achievements", "reminders"],
  heatmapMode: "year",
  heatmapMetric: "words",
  writingGoal: 500,
  writingFolders: [],
  petEnabled: true,
  petName: "Pip",
  petCheckInMinutes: 90,
  quotes: [
    "Small steps still move you forward.",
    "Make the next action obvious.",
    "Done is a direction, not a destination.",
    "Protect your attention; it is your day."
  ]
};

export interface ReminderItem {
  id: string;
  key: string;
  path: string;
  line: number;
  text: string;
  due: number;
  rawDue: string;
  completed: boolean;
  allDay: boolean;
}

export interface DayActivity {
  date: string;
  completed: number;
  total: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: "tasks" | "writing" | "streaks" | "consistency";
  icon: string;
  progress: number;
  target: number;
  unlocked: boolean;
  unlockedAt?: number;
}

export type DashboardSectionId = "hero" | "metrics" | "heatmap" | "achievements" | "reminders";

export interface WritingDay {
  words: number;
  updatedAt: number;
  devices?: Record<string, WritingDeviceDay>;
}

export type WritingMetric = "words" | "characters" | "lines";

export interface WritingMetrics {
  wordsAdded: number;
  wordsRemoved: number;
  charactersAdded: number;
  charactersRemoved: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface WritingDeviceDay extends WritingMetrics {
  updatedAt: number;
}

export interface ProdLifeData {
  schemaVersion: number;
  settings: ProdLifeSettings;
  snoozedUntil: Record<string, number>;
  notified: Record<string, number>;
  completedReminders: Record<string, number>;
  writingHistory: Record<string, WritingDay>;
  writingFiles: Record<string, number>;
  writingInitialized: boolean;
  writingMetricsInitialized: boolean;
  achievementUnlocks: Record<string, number>;
  achievementsInitialized: boolean;
  setupComplete: boolean;
}
