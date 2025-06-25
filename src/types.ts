export interface EmailAnalysis {
  category: "Important" | "Promotional" | "Social" | "Updates" | "Spam" | "Newsletter";
  priority: "High" | "Medium" | "Low";
  needsReply: boolean;
  confidence: number; // 0-100
  analysis: string;
  suggested_response?: string; // Only present if needsReply is true
  suggestedActions: string[];
}

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  payload: {
    headers: GmailMessageHeader[];
    parts?: {
      mimeType: string;
      body: {
        data: string;
      };
    }[];
    body: {
      data: string;
    };
  };
}

export interface EmailBody {
  config: { [key: string]: string };
  data: {
    id: string;
    threadId: string;
    labelIds: string[];
    snippet: string;
    payload: {
      partId: string;
      mimeType: string;
      filename: string;
      headers: { [key: string]: string }[];
      body: { [key: string]: any };
      parts: { [key: string]: any }[];
    };
    sizeEstimate: number;
    historyId: string;
    internalDate: number;
  };
  headers: {
    [key: string]: string;
  };
  status: number;
  statusText: string;
  request: {
    responseURL: string;
  };
}

export interface GmailLabel {
  id: string;
  name: string;
}

// Garbage Cleanup Types
export interface GarbageAnalysis {
  isGarbage: boolean;
  confidence: number; // 0-100
  reasons: string[];
  category: "obvious_spam" | "promotional_old" | "suspicious_domain" | "important" | "safe";
  recommendation: "delete" | "keep" | "review";
  safetyCheck: "passed" | "failed_important_detected" | "failed_business_detected";
}

export interface GarbageCleanupResult {
  totalAnalyzed: number;
  markedForDeletion: number;
  actuallyDeleted: number;
  skippedImportant: number;
  errors: string[];
  dryRun: boolean;
  report: string;
}

export interface GarbageCleanupSettings {
  enabled: boolean;
  confidenceThreshold: number;
  maxEmailsToAnalyze: number;
  onlyDeleteOlderThanDays: number;
  requireMultipleIndicators: boolean;
  safetyMode: "ultra-conservative" | "conservative" | "normal";
  dryRunMode: boolean;
  backupBeforeDelete: boolean;
  scheduleCleanup: boolean;
  cleanupIntervalHours: number;
}
