import { google } from "googleapis";
import { GarbageAnalysis, GarbageCleanupResult, GarbageCleanupSettings, GmailMessage } from "../types";
import { model } from "../index";
import fs from "fs";
import path from "path";

export class GarbageEmailDetector {
  private settings: GarbageCleanupSettings;
  private logger: (message: string) => void;

  constructor(settings: GarbageCleanupSettings, logger?: (message: string) => void) {
    this.settings = settings;
    this.logger = logger || console.log;
  }

  
  private isImportantEmail(subject: string, sender: string, body: string): boolean {
    const importantPatterns = {
      work_business: [
        'meeting', 'deadline', 'project', 'urgent', 'important', 'invoice', 
        'receipt', 'confirmation', 'appointment', 'contract', 'proposal',
        'report', 'presentation', 'client', 'customer', 'vendor', 'supplier'
      ],
      financial: [
        'bank', 'payment', 'transaction', 'statement', 'bill', 'invoice',
        'receipt', 'tax', 'financial', 'account', 'balance', 'credit',
        'debit', 'transfer', 'subscription', 'renewal'
      ],
      personal: [
        'family', 'friend', 'personal', 'birthday', 'anniversary',
        'wedding', 'graduation', 'celebration', 'invitation'
      ],
      security_system: [
        'password reset', 'security alert', 'account verification',
        'two-factor', '2fa', 'login attempt', 'suspicious activity',
        'verification code', 'activation', 'confirmation code'
      ],
      health_legal: [
        'doctor', 'appointment', 'medical', 'health', 'prescription',
        'legal', 'court', 'attorney', 'lawyer', 'insurance'
      ]
    };

    const lowerSubject = subject.toLowerCase();
    const lowerSender = sender.toLowerCase();
    const lowerBody = body.toLowerCase();

    for (const [category, patterns] of Object.entries(importantPatterns)) {
      for (const pattern of patterns) {
        if (lowerSubject.includes(pattern) || lowerSender.includes(pattern) || lowerBody.includes(pattern)) {
          this.logger(`🛡️ Email marked as IMPORTANT (${category}): ${pattern}`);
          return true;
        }
      }
    }

    // Check for known important domains
    const importantDomains = [
      'bank', 'paypal', 'amazon', 'google', 'microsoft', 'apple',
      'government', 'irs', 'official', 'support', 'security',
      'stripe', 'visa', 'mastercard', 'amex', 'discover'
    ];

    for (const domain of importantDomains) {
      if (lowerSender.includes(domain)) {
        this.logger(`🛡️ Email marked as IMPORTANT (trusted domain): ${domain}`);
        return true;
      }
    }

    return false;
  }

  
  private detectObviousGarbage(subject: string, sender: string, body: string, date: Date): GarbageAnalysis {
    if (this.isImportantEmail(subject, sender, body)) {
      return {
        isGarbage: false,
        confidence: 0,
        reasons: ["Detected as important email"],
        category: "important",
        recommendation: "keep",
        safetyCheck: "failed_important_detected"
      };
    }

    const lowerSubject = subject.toLowerCase();
    const lowerSender = sender.toLowerCase();
    const lowerBody = body.toLowerCase();

    let score = 0;
    const reasons: string[] = [];

    const obviousSpamPatterns = [
      'viagra', 'cialis', 'lottery winner', 'congratulations you have won',
      'nigerian prince', 'inheritance claim', 'tax refund pending',
      'click here to claim', 'you are the winner', 'claim your prize now',
      'free money', 'make money fast', 'work from home scam'
    ];

    const spamCount = obviousSpamPatterns.filter(pattern => 
      lowerSubject.includes(pattern) || lowerBody.includes(pattern)
    ).length;

    if (spamCount >= 2) {
      reasons.push(`Multiple obvious spam patterns detected (${spamCount})`);
    }

    const suspiciousDomains = [
      'tempmail', 'guerrillamail', '10minutemail', 'mailinator',
      'throwaway', 'temp-mail', 'discard.email'
    ];

    if (suspiciousDomains.some(domain => lowerSender.includes(domain))) {
      score += 30;
      reasons.push("Suspicious temporary email domain");
    }

    const daysSinceReceived = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceReceived > this.settings.onlyDeleteOlderThanDays) {
      const oldPromoPatterns = ['unsubscribe', 'promotional', 'marketing email'];
      if (oldPromoPatterns.some(pattern => lowerBody.includes(pattern)) && 
          body.trim().length < 200) {
        score += 20;
        reasons.push(`Old promotional email (${Math.floor(daysSinceReceived)} days) with minimal content`);
      }
    }

    if (body.trim().length < 10 && subject.trim().length < 5) {
      score += 25;
      reasons.push("Extremely short/empty email");
    }

    const isGarbage = score >= this.settings.confidenceThreshold && 
                     reasons.length >= (this.settings.requireMultipleIndicators ? 2 : 1);

    return {
      isGarbage,
      confidence: Math.min(score, 100),
      reasons,
      category: isGarbage ? "obvious_spam" : "safe",
      recommendation: isGarbage ? "delete" : "keep",
      safetyCheck: "passed"
    };
  }

  private async aiGarbageAnalysis(subject: string, sender: string, body: string): Promise<GarbageAnalysis> {
    try {
      const prompt = `
      CRITICAL SAFETY INSTRUCTION: You are analyzing an email for potential deletion. Be EXTREMELY CONSERVATIVE.
      When in doubt, ALWAYS recommend KEEP. Only recommend deletion for obvious spam/garbage.

      NEVER recommend deletion if the email contains:
      - Work/business communications (meetings, deadlines, projects)
      - Financial information (invoices, receipts, payments, banking)
      - Personal communications from real people
      - System notifications (password resets, security alerts, verifications)
      - Appointment confirmations or important dates
      - Educational content or courses
      - Legal or government communications

      Only consider for deletion if it's clearly:
      - Obvious spam (viagra, lottery scams, inheritance scams)
      - Completely empty or meaningless emails
      - Emails from known temporary/fake domains
      - Very old promotional emails with zero value

      Email to analyze:
      Subject: ${subject}
      From: ${sender}
      Body (first 500 chars): ${body.substring(0, 500)}

      Respond in JSON format:
      {
        "isGarbage": boolean,
        "confidence": number (0-100),
        "reasons": ["specific reason"],
        "category": "obvious_spam" | "promotional_old" | "important" | "safe",
        "recommendation": "delete" | "keep",
        "safetyOverride": "none" | "important_detected" | "business_detected"
      }
      `;

      const result = await model.generateContent(prompt);
      const response = result.response.text();
      
      const analysis = JSON.parse(response.replace(/```json\n?|\n?```/g, ''));

      if (analysis.safetyOverride !== 'none') {
        analysis.isGarbage = false;
        analysis.recommendation = 'keep';
        analysis.reasons.push("AI safety override triggered");
      }

      return {
        isGarbage: analysis.isGarbage,
        confidence: analysis.confidence,
        reasons: analysis.reasons,
        category: analysis.category,
        recommendation: analysis.recommendation,
        safetyCheck: analysis.safetyOverride === 'none' ? 'passed' : 'failed_important_detected'
      };

    } catch (error) {
      this.logger(`❌ AI analysis failed: ${error}`);
      // On AI failure, always default to keep for safety
      return {
        isGarbage: false,
        confidence: 0,
        reasons: ["AI analysis failed - defaulting to keep for safety"],
        category: "safe",
        recommendation: "keep",
        safetyCheck: "failed_important_detected"
      };
    }
  }

  /**
   * Analyze email for garbage with multiple safety layers
   */
  async analyzeEmail(message: GmailMessage): Promise<GarbageAnalysis> {
    const headers = message.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const sender = headers.find(h => h.name === 'From')?.value || '';
    const dateStr = headers.find(h => h.name === 'Date')?.value || '';
    const date = new Date(dateStr);

    // Extract body
    let body = '';
    if (message.payload.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString();
    } else if (message.payload.parts) {
      for (const part of message.payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString();
          break;
        }
      }
    }

    // First layer: Pattern-based detection
    const patternAnalysis = this.detectObviousGarbage(subject, sender, body, date);

    // If pattern analysis detected important email, return immediately
    if (patternAnalysis.safetyCheck === 'failed_important_detected') {
      return patternAnalysis;
    }

    // If pattern analysis suggests garbage with high confidence, get AI confirmation
    if (patternAnalysis.isGarbage && patternAnalysis.confidence >= 70) {
      const aiAnalysis = await this.aiGarbageAnalysis(subject, sender, body);
      
      // Combine analyses, but AI has veto power for safety
      if (aiAnalysis.safetyCheck === 'failed_important_detected') {
        return aiAnalysis; // AI detected important content, keep email
      }

      // Both agree it's garbage
      if (aiAnalysis.isGarbage) {
        return {
          isGarbage: true,
          confidence: Math.max(patternAnalysis.confidence, aiAnalysis.confidence),
          reasons: [...new Set([...patternAnalysis.reasons, ...aiAnalysis.reasons])],
          category: aiAnalysis.category,
          recommendation: "delete",
          safetyCheck: "passed"
        };
      }
    }

    // Default to pattern analysis result (usually keep)
    return patternAnalysis;
  }

  /**
   * Backup email before deletion
   */
  private async backupEmail(auth: any, messageId: string): Promise<boolean> {
    try {
      const gmail = google.gmail({ version: 'v1', auth });
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const backupDir = path.join(process.cwd(), 'email_backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const backupFile = path.join(backupDir, `${messageId}_${Date.now()}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(message.data, null, 2));

      this.logger(`📄 Email backup created: ${backupFile}`);
      return true;
    } catch (error) {
      this.logger(`❌ Failed to backup email ${messageId}: ${error}`);
      return false;
    }
  }

  /**
   * Main garbage cleanup function
   */
  async runGarbageCleanup(auth: any): Promise<GarbageCleanupResult> {
    if (!this.settings.enabled) {
      return {
        totalAnalyzed: 0,
        markedForDeletion: 0,
        actuallyDeleted: 0,
        skippedImportant: 0,
        errors: [],
        dryRun: false,
        report: "Garbage cleanup is disabled"
      };
    }

    this.logger("🗑️ Starting garbage email cleanup...");
    
    const gmail = google.gmail({ version: 'v1', auth });
    const result: GarbageCleanupResult = {
      totalAnalyzed: 0,
      markedForDeletion: 0,
      actuallyDeleted: 0,
      skippedImportant: 0,
      errors: [],
      dryRun: this.settings.dryRunMode,
      report: ""
    };

    try {
      // Get emails to analyze
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: this.settings.maxEmailsToAnalyze,
        q: 'in:inbox OR in:spam' // Look in inbox and spam folder
      });

      const messages = response.data.messages || [];
      this.logger(`📧 Found ${messages.length} emails to analyze`);

      const analysisResults: { message: GmailMessage; analysis: GarbageAnalysis }[] = [];

      // Analyze each email
      for (const messageRef of messages) {
        try {
          const message = await gmail.users.messages.get({
            userId: 'me',
            id: messageRef.id!,
            format: 'full'
          });

          const analysis = await this.analyzeEmail(message.data as GmailMessage);
          analysisResults.push({ message: message.data as GmailMessage, analysis });
          
          result.totalAnalyzed++;

          if (analysis.safetyCheck === 'failed_important_detected') {
            result.skippedImportant++;
          } else if (analysis.isGarbage && analysis.recommendation === 'delete') {
            result.markedForDeletion++;
          }

          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          result.errors.push(`Failed to analyze message ${messageRef.id}: ${error}`);
        }
      }

      // Generate report
      result.report = this.generateCleanupReport(analysisResults);

      // Delete emails if not in dry run mode
      if (!this.settings.dryRunMode) {
        for (const { message, analysis } of analysisResults) {
          if (analysis.isGarbage && analysis.recommendation === 'delete' && 
              analysis.safetyCheck === 'passed') {
            
            try {
              // Backup before deletion if enabled
              if (this.settings.backupBeforeDelete) {
                const backupSuccess = await this.backupEmail(auth, message.id);
                if (!backupSuccess) {
                  result.errors.push(`Failed to backup ${message.id}, skipping deletion`);
                  continue;
                }
              }

              // Move to trash (safer than permanent deletion)
              await gmail.users.messages.trash({
                userId: 'me',
                id: message.id
              });

              result.actuallyDeleted++;
              this.logger(`🗑️ Moved to trash: ${message.id}`);

            } catch (error) {
              result.errors.push(`Failed to delete ${message.id}: ${error}`);
            }
          }
        }
      }

    } catch (error) {
      result.errors.push(`Cleanup failed: ${error}`);
    }

    this.logger("✅ Garbage cleanup completed");
    return result;
  }

  private generateCleanupReport(results: { message: GmailMessage; analysis: GarbageAnalysis }[]): string {
    let report = `🗑️ GARBAGE EMAIL CLEANUP REPORT\n`;
    report += `${'='.repeat(50)}\n\n`;

    const garbageEmails = results.filter(r => r.analysis.isGarbage);
    const importantEmails = results.filter(r => r.analysis.safetyCheck === 'failed_important_detected');

    report += `📊 Summary:\n`;
    report += `- Total emails analyzed: ${results.length}\n`;
    report += `- Marked as garbage: ${garbageEmails.length}\n`;
    report += `- Protected as important: ${importantEmails.length}\n`;
    report += `- Dry run mode: ${this.settings.dryRunMode ? 'YES' : 'NO'}\n\n`;

    if (garbageEmails.length > 0) {
      report += `🗑️ Emails marked for deletion:\n`;
      garbageEmails.forEach((result, i) => {
        const subject = result.message.payload.headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const sender = result.message.payload.headers.find(h => h.name === 'From')?.value || 'Unknown';
        
        report += `${i + 1}. Subject: ${subject.substring(0, 50)}...\n`;
        report += `   From: ${sender}\n`;
        report += `   Confidence: ${result.analysis.confidence}%\n`;
        report += `   Reasons: ${result.analysis.reasons.join(', ')}\n\n`;
      });
    }

    if (importantEmails.length > 0) {
      report += `🛡️ Important emails protected:\n`;
      importantEmails.slice(0, 5).forEach((result, i) => {
        const subject = result.message.payload.headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        report += `${i + 1}. ${subject.substring(0, 60)}...\n`;
      });
      if (importantEmails.length > 5) {
        report += `... and ${importantEmails.length - 5} more\n`;
      }
    }

    return report;
  }
}
