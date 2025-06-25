import path from "path";
import { promises as fs } from "fs";
import { GarbageCleanupSettings } from "../types";

export interface AppSettings {
  rateLimiting: {
    maxRequestsPerMinute: number;
    checkIntervalMinutes: number;
  };
  emailProcessing: {
    maxEmailsPerCheck: number;
    onlyCreateDraftsForImportant: boolean;
    autoLabelEmails: boolean;
    moveSpamToSpamFolder: boolean;
  };
  aiAnalysis: {
    minimumConfidenceThreshold: number;
    requiresReplyCategories: string[];
    ignoredCategories: string[];
  };
  labels: {
    important: string;
    promotional: string;
    social: string;
    updates: string;
    spam: string;
    newsletter: string;
    reviewNeeded: string;
  };
  smartFiltering: {
    enableEnhancedSpamDetection: boolean;
    enableContentAnalysis: boolean;
    enableSubjectAnalysis: boolean;
  };
  garbageCleanup: GarbageCleanupSettings;
}

let cachedSettings: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cachedSettings) {
    return cachedSettings;
  }

  const settingsPath = path.join(process.cwd(), "src/config", "settings.json");

  try {
    const content = await fs.readFile(settingsPath, "utf8");
    cachedSettings = JSON.parse(content);
    return cachedSettings!;
  } catch (error) {
    console.error("Error loading settings, using defaults:", error);
    
    const defaultSettings: AppSettings = {
      rateLimiting: {
        maxRequestsPerMinute: 15,
        checkIntervalMinutes: 5
      },
      emailProcessing: {
        maxEmailsPerCheck: 10,
        onlyCreateDraftsForImportant: true,
        autoLabelEmails: true,
        moveSpamToSpamFolder: true
      },
      aiAnalysis: {
        minimumConfidenceThreshold: 70,
        requiresReplyCategories: ["Important"],
        ignoredCategories: ["Spam", "Promotional"]
      },
      labels: {
        important: "📧 Important",
        promotional: "📢 Promotional",
        social: "👥 Social", 
        updates: "🔄 Updates",
        spam: "🗑️ Spam",
        newsletter: "📰 Newsletter",
        reviewNeeded: "🔧 Review Needed"
      },
      smartFiltering: {
        enableEnhancedSpamDetection: true,
        enableContentAnalysis: true,
        enableSubjectAnalysis: true
      },
      garbageCleanup: {
        enabled: false,
        confidenceThreshold: 85,
        maxEmailsToAnalyze: 20,
        onlyDeleteOlderThanDays: 30,
        requireMultipleIndicators: true,
        safetyMode: "ultra-conservative",
        dryRunMode: true,
        backupBeforeDelete: true,
        scheduleCleanup: false,
        cleanupIntervalHours: 24
      }
    };
    
    cachedSettings = defaultSettings;
    return defaultSettings;
  }
}

export function refreshSettings(): void {
  cachedSettings = null;
}
