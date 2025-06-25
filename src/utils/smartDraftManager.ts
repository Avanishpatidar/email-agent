import { GoogleGenerativeAI } from "@google/generative-ai";
import { google } from "googleapis";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.0-flash-lite",
  generationConfig: {
    temperature: 0.7,
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 300,
  }
});

export interface EmailData {
  from: string;
  subject: string;
  content: string;
  messageId: string;
  threadId: string;
}

export interface DraftResult {
  shouldCreateDraft: boolean;
  draftContent?: string;
  reason: string;
  confidence: number;
}

/**
 * Analyzes if an email requires a reply and creates a smart draft if needed
 */
export async function createSmartDraft(
  auth: any,
  emailData: EmailData,
  category: string,
  priority: string
): Promise<DraftResult> {
  try {
    // First, determine if this email actually needs a reply
    const shouldReply = await shouldEmailGetReply(emailData, category);
    
    if (!shouldReply.needsReply) {
      return {
        shouldCreateDraft: false,
        reason: shouldReply.reason,
        confidence: shouldReply.confidence
      };
    }

    // If it needs a reply, generate a smart draft
    const draftContent = await generateSmartDraft(emailData, category, priority);
    
    if (draftContent) {
      // Create the actual draft in Gmail
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

/**
 * Determines if an email genuinely needs a human reply
 */
async function shouldEmailGetReply(
  emailData: EmailData,
  category: string
): Promise<{ needsReply: boolean; reason: string; confidence: number }> {
  
  // Quick pre-filters - don't even use AI for obvious cases
  const sender = emailData.from.toLowerCase();
  const subject = emailData.subject.toLowerCase();
  
  // Automated senders that never need replies
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
  
  // Subject lines that indicate no reply needed
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
  
  // Categories that typically don't need replies
  if (["Promotional", "Newsletter", "Updates", "Spam"].includes(category)) {
    return {
      needsReply: false,
      reason: `Category '${category}' typically doesn't require replies`,
      confidence: 85
    };
  }
  
  // Use AI for more complex analysis
  try {
    const prompt = `Analyze this email and determine if it requires a human reply.

FROM: ${emailData.from}
SUBJECT: ${emailData.subject}
CONTENT: ${emailData.content.substring(0, 500)}...
CATEGORY: ${category}

Consider:
- Is this asking a question or requesting information?
- Does it require a human decision or response?
- Is it a personal message that warrants a reply?
- Is it a business inquiry or opportunity?
- Is it just informational/automated?

Reply with ONLY:
- "YES" if it needs a human reply
- "NO" if it's informational/automated

Be conservative - only say YES if genuinely needs human attention.`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim().toUpperCase();
    
    if (response === "YES") {
      return {
        needsReply: true,
        reason: "AI determined email requires human response",
        confidence: 80
      };
    } else {
      return {
        needsReply: false,
        reason: "AI determined no reply needed",
        confidence: 80
      };
    }
  } catch (error) {
    console.error("AI analysis failed, defaulting to no reply:", error);
    return {
      needsReply: false,
      reason: "AI analysis failed - defaulting to no reply",
      confidence: 50
    };
  }
}

/**
 * Generates a contextual, professional draft response
 */
async function generateSmartDraft(
  emailData: EmailData,
  category: string,
  priority: string
): Promise<string | null> {
  try {
    const senderName = emailData.from.split('<')[0].trim() || "there";
    
    const prompt = `Create a professional, contextual reply draft for this email:

FROM: ${emailData.from}
SUBJECT: ${emailData.subject}
CONTENT: ${emailData.content.substring(0, 800)}
CATEGORY: ${category}
PRIORITY: ${priority}

Create a response that:
1. Acknowledges their message appropriately
2. Is professional but warm in tone
3. Addresses any questions or requests mentioned
4. Is concise (2-4 sentences max)
5. Ends with appropriate next steps or closing

Do not include:
- Email headers (To:, From:, Subject:)
- Salutation (Dear/Hi will be added automatically)
- Signature (will be added automatically)

Just provide the main body content of the reply.`;

    const result = await model.generateContent(prompt);
    const draftContent = result.response.text().trim();
    
    // Add proper email formatting
    const formattedDraft = `Hi ${senderName},

${draftContent}

Best regards,
Avanish Patidar`;
    
    return formattedDraft;
  } catch (error) {
    console.error("Error generating draft content:", error);
    return null;
  }
}

/**
 * Creates a draft in Gmail
 */
async function createGmailDraft(
  auth: any,
  emailData: EmailData,
  draftContent: string
): Promise<void> {
  try {
    const gmail = google.gmail({ version: "v1", auth });
    
    // Create reply subject
    const replySubject = emailData.subject.startsWith("Re: ") 
      ? emailData.subject 
      : `Re: ${emailData.subject}`;
    
    // Create the draft message
    const draftMessage = [
      `To: ${emailData.from}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${emailData.messageId}`,
      `References: ${emailData.messageId}`,
      "",
      draftContent
    ].join("\r\n");
    
    // Encode the message
    const encodedMessage = Buffer.from(draftMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    
    // Create the draft
    await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: encodedMessage,
          threadId: emailData.threadId
        }
      }
    });
    
    console.log(`✅ Smart draft created for: ${emailData.subject.substring(0, 50)}...`);
  } catch (error) {
    console.error("Error creating Gmail draft:", error);
    throw error;
  }
}

/**
 * Get statistics about draft creation
 */
export interface DraftStats {
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

export function updateDraftStats(category: string, draftCreated: boolean): void {
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

export function getDraftStats(): DraftStats {
  return { ...draftStats };
}

export function resetDraftStats(): void {
  draftStats = {
    totalEmailsProcessed: 0,
    draftsCreated: 0,
    draftsSkipped: 0,
    successRate: 0,
    categories: {}
  };
}
