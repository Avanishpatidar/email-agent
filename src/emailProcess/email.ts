import { google } from "googleapis";
import { GmailMessage, GmailMessageHeader } from "../types";
import { CHECK_POST_CURRENT_TIME, MAX_MAIL } from "..";
import { getLastProcessedTime, updateLastProcessedTime } from "../utils";
import { shouldIgnoreEmail } from "../spamEmail/pattern";
import { analyzeEmail } from "../ai/analyzeEmail";
import { GarbageEmailDetector } from "./garbageCleanup";
import { loadSettings } from "../config/settingsLoader";

interface EmailData {
  from: string;
  subject: string;
  content: string;
  messageId: string;
  threadId: string;
}

interface DraftResult {
  shouldCreateDraft: boolean;
  draftContent?: string;
  reason: string;
  confidence: number;
}

interface DraftStats {
  totalEmailsProcessed: number;
  draftsCreated: number;
  draftsSkipped: number;
  successRate: number;
  categories: Record<string, { processed: number; draftsCreated: number }>;
}

let draftStats: DraftStats = {
  totalEmailsProcessed: 0,
  draftsCreated: 0,
  draftsSkipped: 0,
  successRate: 0,
  categories: {}
};

async function createSmartDraft(
  auth: any,
  emailData: EmailData,
  category: string,
  priority: string
): Promise<DraftResult> {
  try {
    const shouldReply = await shouldEmailGetReply(emailData, category, priority);
    
    if (!shouldReply.needsReply) {
      return {
        shouldCreateDraft: false,
        reason: shouldReply.reason,
        confidence: shouldReply.confidence
      };
    }

    console.log("🤖 Generating smart draft content...");
    const draftContent = await generateSmartDraft(emailData, category, priority);
    
    if (draftContent) {
      console.log("📧 Creating Gmail draft...");
      await createGmailDraft(auth, emailData, draftContent);
      
      return {
        shouldCreateDraft: true,
        draftContent,
        reason: "Created smart draft for email requiring response",
        confidence: shouldReply.confidence
      };
    } else {
      return {
        shouldCreateDraft: false,
        reason: "Failed to generate appropriate draft content",
        confidence: 50
      };
    }
  } catch (error) {
    console.error("Error in createSmartDraft:", error);
    return {
      shouldCreateDraft: false,
      reason: "Error occurred while creating draft",
      confidence: 0
    };
  }
}

async function shouldEmailGetReply(
  emailData: EmailData,
  category: string,
  priority?: string
): Promise<{ needsReply: boolean; reason: string; confidence: number }> {
  
  const sender = emailData.from.toLowerCase();
  const subject = emailData.subject.toLowerCase();
  
  const automatedSenders = [
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "automated", "system", "support@", "admin@",
    "notifications@", "updates@", "news@",
    "amazon.com", "paypal.com", "google.com",
    "facebook.com", "twitter.com", "linkedin.com",
    "github.com", "stackoverflow.com"
  ];
  
  if (automatedSenders.some(auto => sender.includes(auto))) {
    return {
      needsReply: false,
      reason: "Automated sender - no reply needed",
      confidence: 95
    };
  }
  
  const noReplySubjects = [
    "confirmation", "receipt", "order", "shipped", "delivered",
    "newsletter", "digest", "update", "notification",
    "password", "reset", "verify", "activated",
    "welcome", "thank you for", "subscription"
  ];
  
  if (noReplySubjects.some(noReply => subject.includes(noReply))) {
    return {
      needsReply: false,
      reason: "Automated notification - no reply needed",
      confidence: 90
    };
  }
  
  if (["Promotional", "Newsletter", "Updates", "Spam"].includes(category)) {
    return {
      needsReply: false,
      reason: `Category '${category}' typically doesn't require replies`,
      confidence: 85
    };
  }
  
  if (category === "Important" || priority === "High") {
    return {
      needsReply: true,
      reason: "Important email likely requires response",
      confidence: 85
    };
  }
  
  return {
    needsReply: true,
    reason: "Email may require response - creating draft",
    confidence: 70
  };
}

async function generateSmartDraft(
  emailData: EmailData,
  category: string,
  priority: string
): Promise<string | null> {
  try {
    const senderName = emailData.from.split('<')[0].trim() || "there";
    
    const draftContent = `Thank you for your email regarding "${emailData.subject}". 

I appreciate you reaching out and will review this carefully. I'll get back to you with a proper response shortly.

Best regards,
Avanish Patidar`;
    
    return draftContent;
  } catch (error) {
    console.error("Error generating draft content:", error);
    return null;
  }
}

async function createGmailDraft(
  auth: any,
  emailData: EmailData,
  draftContent: string
): Promise<void> {
  try {
    const gmail = google.gmail({ version: "v1", auth });
    
    const replySubject = emailData.subject.startsWith("Re: ") 
      ? emailData.subject 
      : `Re: ${emailData.subject}`;
    
    const draftMessage = [
      `To: ${emailData.from}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${emailData.messageId}`,
      `References: ${emailData.messageId}`,
      `Content-Type: text/plain; charset=UTF-8`,
      "",
      draftContent
    ].join("\r\n");
    
    const encodedMessage = Buffer.from(draftMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    
    const draftResponse = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: encodedMessage,
          threadId: emailData.threadId
        }
      }
    });
    
    console.log(`✅ Smart draft created successfully!`);
    console.log(`   📧 Subject: ${replySubject}`);
    console.log(`   📨 To: ${emailData.from}`);
    console.log(`   🆔 Draft ID: ${draftResponse.data.id}`);
    console.log(`   📂 You can find this draft in your Gmail drafts folder`);
    
  } catch (error) {
    console.error("❌ Error creating Gmail draft:", error);
    throw error;
  }
}

function updateDraftStats(category: string, draftCreated: boolean): void {
  draftStats.totalEmailsProcessed++;
  
  if (!draftStats.categories[category]) {
    draftStats.categories[category] = { processed: 0, draftsCreated: 0 };
  }
  
  draftStats.categories[category].processed++;
  
  if (draftCreated) {
    draftStats.draftsCreated++;
    draftStats.categories[category].draftsCreated++;
  } else {
    draftStats.draftsSkipped++;
  }
  
  draftStats.successRate = (draftStats.draftsCreated / draftStats.totalEmailsProcessed) * 100;
}

function getDraftStats(): DraftStats {
  return { ...draftStats };
}

async function getOrCreateLabel(auth: any, labelName: string): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth });

  try {
    const res = await gmail.users.labels.list({ userId: "me" });
    const existingLabel = res.data.labels?.find((label) => label.name === labelName);

    if (existingLabel) {
      return existingLabel.id!!;
    }

    const newLabel = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });

    console.log(`→ Created new label: ${labelName}`);
    return newLabel.data.id ?? "";
  } catch (error) {
    console.error("Error managing label:", error);
    throw error;
  }
}

async function sendReply(
  auth: any,
  originalMessage: GmailMessage,
  replyText: string
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth });

  const headers = originalMessage.payload.headers;
  const subject = headers.find((header) => header.name === "Subject")?.value || "";
  const from = headers.find((header) => header.name === "From")?.value || "";
  const messageId = headers.find((header) => header.name === "Message-ID")?.value || "";

  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const emailContent = `From: me
To: ${from}
Subject: ${replySubject}
In-Reply-To: ${messageId}
References: ${messageId}
Content-Type: text/plain; charset="UTF-8"

${replyText}`;

  const encodedEmail = Buffer.from(emailContent)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedEmail,
      threadId: originalMessage.threadId,
    },
  });
}

function shouldSkipAIAnalysis(from: string, subject: string, content: string): { skip: boolean, reason: string, category: string } {
  const lowerFrom = from.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const lowerContent = content.toLowerCase();
  
  if (lowerFrom.includes('noreply') || lowerFrom.includes('no-reply') || 
      lowerFrom.includes('donotreply') || lowerFrom.includes('automated')) {
    return { skip: true, reason: 'Automated sender', category: 'Newsletter' };
  }
  
  if (lowerContent.includes('unsubscribe') || lowerSubject.includes('newsletter') ||
      lowerSubject.includes('promotion') || lowerSubject.includes('deal') ||
      lowerSubject.includes('sale') || lowerContent.includes('marketing@')) {
    return { skip: true, reason: 'Marketing/Newsletter', category: 'Promotional' };
  }
  
  if (lowerFrom.includes('facebook') || lowerFrom.includes('twitter') || 
      lowerFrom.includes('linkedin') || lowerFrom.includes('instagram') ||
      lowerFrom.includes('notification') && (lowerFrom.includes('social') || lowerSubject.includes('liked'))) {
    return { skip: true, reason: 'Social media notification', category: 'Social' };
  }
  
  if ((lowerSubject.includes('order') || lowerSubject.includes('shipped') || 
       lowerSubject.includes('delivery') || lowerSubject.includes('tracking')) &&
      (lowerFrom.includes('amazon') || lowerFrom.includes('fedex') || 
       lowerFrom.includes('ups') || lowerFrom.includes('shipping'))) {
    return { skip: true, reason: 'Shipping/Order confirmation', category: 'Updates' };
  }
  
  if (lowerSubject.includes('backup') || lowerSubject.includes('server') ||
      lowerSubject.includes('system') || lowerSubject.includes('maintenance') ||
      lowerSubject.includes('alert') && lowerFrom.includes('monitoring')) {
    return { skip: true, reason: 'System notification', category: 'Updates' };
  }
  
  return { skip: false, reason: 'Requires AI analysis', category: 'Unknown' };
}

let processingStats = {
  totalProcessed: 0,
  aiAnalyzed: 0,
  preFiltered: 0,
  draftsCreated: 0,
  apiCallsSaved: 0,
  lastProcessedTime: 'Never'
};

export function getProcessingStats() {
  return { ...processingStats };
}

export function resetProcessingStats() {
  processingStats = {
    totalProcessed: 0,
    aiAnalyzed: 0,
    preFiltered: 0,
    draftsCreated: 0,
    apiCallsSaved: 0,
    lastProcessedTime: 'Never'
  };
}

// Main email processing function with smart categorization
async function processNewEmails(auth: any): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth });

  try {
    let query = "is:unread";

    if (CHECK_POST_CURRENT_TIME) {
      const lastProcessedTime = await getLastProcessedTime();
      const afterDate = new Date(lastProcessedTime).toISOString();
      query += ` after:${afterDate}`;
    }

    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: MAX_MAIL,
    });

    if (!res.data.messages) {
      console.log("No new messages found.");
      if (CHECK_POST_CURRENT_TIME) {
        await updateLastProcessedTime(Date.now());
      }
      return;
    }

    console.log(`Found ${res.data.messages.length} unread messages`);
    // Process each email with enhanced filtering and 5-second delays
    for (let i = 0; i < res.data.messages.length; i++) {
      const message = res.data.messages[i];
      
      // Add delay between emails (except for the first one) - 5 seconds
      if (i > 0) {
      console.log(`→ Waiting 5 seconds before processing next email (${i + 1}/${res.data.messages.length})...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds delay
      }
      // @ts-ignore
      const email = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full",
      });

      // @ts-ignore
      const headers: GmailMessageHeader[] = email?.data?.payload.headers || [];
      const from = headers.find((header) => header.name === "From")?.value || "";
      const to = headers.find((header) => header.name === "To")?.value || "";
      const subject = headers.find((header) => header.name === "Subject")?.value || "(no subject)";
      const messageId = headers.find((header) => header.name === "Message-ID")?.value || "";
      // @ts-ignore
      const threadId = email?.data?.threadId || "";

      console.log(`\nProcessing email from: ${from}`);
      console.log(`Subject: ${subject}`);

      // Extract email content
      // @ts-ignore
      const emailPayload = email?.data?.payload;
      let emailContent = "";

      if (emailPayload.parts) {
        for (const part of emailPayload.parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            emailContent += Buffer.from(part.body.data, "base64").toString();
          }
        }
      } else if (emailPayload.body?.data) {
        emailContent = Buffer.from(emailPayload.body.data, "base64").toString();
      }

      // Enhanced spam detection with subject and content - BEFORE AI analysis
      if (await shouldIgnoreEmail(from, subject, emailContent)) {
        console.log(`→ Email filtered out by spam detection - saving API call`);
        
        // Determine appropriate action based on sender
        const spamLabelId = await getOrCreateLabel(auth, "🗑️ Spam");
        
        // @ts-ignore
        await gmail.users.messages.modify({
          userId: "me",
          id: message.id,
          requestBody: {
            addLabelIds: [spamLabelId],
            removeLabelIds: ["UNREAD", "INBOX"],
          },
        });
        continue;
      }

      if (!emailContent.trim()) {
        console.log("→ No readable content found in email");
        continue;
      }

      // Smart pre-filtering to reduce API usage for Gemini 2.0 Flash-Lite
      const preFilterResult = shouldSkipAIAnalysis(from, subject, emailContent);
      
      if (preFilterResult.skip) {
        console.log(`→ Pre-filtered: ${preFilterResult.reason} - saving API call`);
        processingStats.preFiltered++;
        processingStats.apiCallsSaved++;
        
        const labelName = `📧 ${preFilterResult.category}`;
        const labelId = await getOrCreateLabel(auth, labelName);
        
        // @ts-ignore
        await gmail.users.messages.modify({
          userId: "me",
          id: message.id,
          requestBody: {
            addLabelIds: [labelId],
            removeLabelIds: ["UNREAD"],
          },
        });
        continue;
      }

      processingStats.totalProcessed++;

      // Check if AI analysis can be skipped
      const skipAI = shouldSkipAIAnalysis(from, subject, emailContent);
      if (skipAI.skip) {
        console.log(`→ Skipping AI analysis: ${skipAI.reason}`);
        processingStats.preFiltered++;

        // Create label for pre-filtered emails
        const preFilterLabelId = await getOrCreateLabel(auth, "📂 Pre-filtered");
        
        // @ts-ignore
        await gmail.users.messages.modify({
          userId: "me",
          id: message.id,
          requestBody: {
            addLabelIds: [preFilterLabelId],
            removeLabelIds: ["UNREAD"],
          },
        });
        continue;
      }

      // Only use AI for emails that passed all pre-filtering
      try {
        console.log("🤖 Analyzing with Gemini 2.0 Flash-Lite...");
        const startTime = Date.now();
        
        const analysis = await analyzeEmail(emailContent, from, to, subject);
        
        const analysisTime = Date.now() - startTime;
        processingStats.aiAnalyzed++;
        
        console.log(`⚡ AI analysis completed in ${analysisTime}ms`);
        console.log(`📊 Categorized as: ${analysis.category} (${analysis.priority} priority)`);
        console.log(`🎯 Confidence: ${analysis.confidence}% | Reply needed: ${analysis.needsReply}`);
        
        // Create appropriate label based on category
        const labelName = `📧 ${analysis.category}`;
        const labelId = await getOrCreateLabel(auth, labelName);

        // Apply label and remove from unread
        // @ts-ignore
        await gmail.users.messages.modify({
          userId: "me",
          id: message.id,
          requestBody: {
            addLabelIds: [labelId],
            removeLabelIds: ["UNREAD"],
          },
        });
        
        // Use smart draft creation - it will determine if email needs a reply
        if (analysis.needsReply || analysis.category === "Important") {
          console.log(`\n🤖 Evaluating if email needs a smart draft response...`);
          console.log(`   📧 From: ${from}`);
          console.log(`   📝 Subject: ${subject}`);
          console.log(`   📂 Category: ${analysis.category} (${analysis.priority} priority)`);
          
          try {
            const emailData: EmailData = {
              from,
              subject,
              content: emailContent,
              messageId,
              threadId
            };
            
            const draftResult = await createSmartDraft(auth, emailData, analysis.category, analysis.priority);
            
            if (draftResult.shouldCreateDraft) {
              console.log(`\n🎉 SUCCESS: Smart draft has been created!`);
              console.log(`   ✅ Reason: ${draftResult.reason}`);
              console.log(`   📊 Confidence: ${draftResult.confidence}%`);
              console.log(`   📬 Check your Gmail drafts folder to see the generated reply`);
              processingStats.draftsCreated++;
            } else {
              console.log(`\n⏭️  SKIPPED: Draft not created`);
              console.log(`   ❌ Reason: ${draftResult.reason}`);
              console.log(`   📊 Confidence: ${draftResult.confidence}%`);
            }
            
            // Update draft statistics
            updateDraftStats(analysis.category, draftResult.shouldCreateDraft);
          } catch (draftError) {
            console.error("\n❌ ERROR: Failed to create smart draft:", draftError);
            console.log("→ Continuing with email labeling...");
          }
        } else {
          console.log(`\n⏭️  SKIPPED: No draft needed`);
          console.log(`   📂 Category: ${analysis.category}`);
          console.log(`   📝 Needs Reply: ${analysis.needsReply}`);
          updateDraftStats(analysis.category, false);
        }

        // Log suggested actions
        if (analysis.suggestedActions && analysis.suggestedActions.length > 0) {
          console.log("→ Suggested Actions:", analysis.suggestedActions.join(", "));
        }

        processingStats.aiAnalyzed++;
        console.log("→ Successfully processed email");
        console.log("\n--- Waiting for next email analysis... ---");
      } catch (error) {
        console.error(
          "→ Error processing this email:",
          error instanceof Error ? error.message : "Unknown error"
        );
        
        // Move problematic emails to a separate label for manual review
        try {
          const errorLabelId = await getOrCreateLabel(auth, "🔧 Review Needed");
          // @ts-ignore
          await gmail.users.messages.modify({
            userId: "me",
            id: message.id,
            requestBody: {
              addLabelIds: [errorLabelId],
              removeLabelIds: ["UNREAD"],
            },
          });
        } catch (labelError) {
          console.error("→ Failed to apply error label:", labelError);
        }
        
        continue;
      }

      processingStats.totalProcessed++;
    }

    if (CHECK_POST_CURRENT_TIME) {
      await updateLastProcessedTime(Date.now());
    }

    // Display smart draft statistics
    const draftStats = getDraftStats();
    if (draftStats.totalEmailsProcessed > 0) {
      console.log("\n📊 Smart Draft Statistics:");
      console.log(`   Total emails processed: ${draftStats.totalEmailsProcessed}`);
      console.log(`   Drafts created: ${draftStats.draftsCreated}`);
      console.log(`   Drafts skipped: ${draftStats.draftsSkipped}`);
      console.log(`   Success rate: ${draftStats.successRate.toFixed(1)}%`);
      
      if (Object.keys(draftStats.categories).length > 0) {
        console.log("   By category:");
        Object.entries(draftStats.categories).forEach(([category, stats]) => {
          const categoryStats = stats as { processed: number; draftsCreated: number };
          const rate = (categoryStats.draftsCreated / categoryStats.processed * 100).toFixed(1);
          console.log(`     ${category}: ${categoryStats.draftsCreated}/${categoryStats.processed} (${rate}%)`);
        });
      }
    }

    try {
      const settings = await loadSettings();
      if (settings.garbageCleanup.enabled) {
        console.log("\n🗑️ Running garbage email cleanup...");
        const garbageDetector = new GarbageEmailDetector(
          settings.garbageCleanup, 
          (message: string) => console.log(`   ${message}`)
        );
        
        const cleanupResult = await garbageDetector.runGarbageCleanup(auth);
        
        console.log("\n📋 Garbage Cleanup Summary:");
        console.log(`   Emails analyzed: ${cleanupResult.totalAnalyzed}`);
        console.log(`   Marked for deletion: ${cleanupResult.markedForDeletion}`);
        console.log(`   Actually deleted: ${cleanupResult.actuallyDeleted}`);
        console.log(`   Protected as important: ${cleanupResult.skippedImportant}`);
        console.log(`   Dry run mode: ${cleanupResult.dryRun ? 'YES' : 'NO'}`);
        
        if (cleanupResult.errors.length > 0) {
          console.log(`   Errors: ${cleanupResult.errors.length}`);
        }
        
        if (cleanupResult.dryRun && cleanupResult.markedForDeletion > 0) {
          console.log("\n⚠️  Note: Dry run mode is enabled. No emails were actually deleted.");
          console.log("   To enable actual deletion, set 'dryRunMode': false in settings.json");
        }
      }
    } catch (garbageError) {
      console.error("❌ Garbage cleanup failed:", garbageError);
    }
  } catch (error) {
    console.error("Error in processNewEmails:", error);
  }
}

export { getOrCreateLabel, processNewEmails };
