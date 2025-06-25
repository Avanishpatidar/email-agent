import { ChatSession } from "@google/generative-ai";
import { model, SENDERS_NAME } from "..";
import { EmailAnalysis } from "../types";
import { generationConfig } from "../config/config";

let dailyApiCalls = 0;
let lastResetDate = new Date().toDateString();
let lastApiCallTime = 0;

export async function analyzeEmail(
  emailContent: string,
  from: string,
  to: string,
  subject: string
): Promise<EmailAnalysis> {
  
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyApiCalls = 0;
    lastResetDate = today;
    console.log(`🔄 Daily API usage counter reset`);
  }
  
  if (dailyApiCalls > 1000) { // Conservative daily limit
    console.log(`⚠️ Skipping AI analysis to preserve quota`);
    return {
      category: "Updates",
      priority: "Medium",
      needsReply: false,
      confidence: 50,
      analysis: "Analysis skipped to preserve daily quota",
      suggestedActions: ["Mark as read"]
    };
  }
  
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  if (timeSinceLastCall < 3000) {
    const waitTime = 3000 - timeSinceLastCall;
    console.log(`⏳ Rate limiting: waiting ${waitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  const prompt = `Analyze this email quickly. Return JSON only.

FROM: ${from}
SUBJECT: ${subject}
CONTENT: ${emailContent.substring(0, 800)}

Categories: Important, Promotional, Social, Updates, Newsletter, Spam
Priority: High, Medium, Low
NeedsReply: true ONLY for personal messages requiring responses

Reply Rules:
- TRUE: Job offers, business inquiries, personal messages, meeting requests
- FALSE: Newsletters, promotions, notifications, automated emails

JSON format:
{
  "category": "category",
  "priority": "priority",
  "needsReply": false,
  "confidence": 90,
  "analysis": "brief reason",
  "suggestedActions": ["action"]
}`;

  const maxRetries = 2; 
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const chatSession: ChatSession = model.startChat({
        generationConfig: {
          ...generationConfig,
          maxOutputTokens: 512, 
          temperature: 0.7,
          topP: 0.85,
          topK: 40
        },
        history: [],
      });

      console.log(`🤖 Gemini 2.0 Flash-Lite analysis (attempt ${attempt}/${maxRetries})...`);
      const startTime = Date.now();
      
      const result = await chatSession.sendMessage(prompt);
      
      const processingTime = Date.now() - startTime;
      console.log(`⚡ Analysis completed in ${processingTime}ms`);
      
      lastApiCallTime = Date.now();
      dailyApiCalls++;
      console.log(`✅ API call successful. Daily usage: ${dailyApiCalls}`);
      
      const responseText = result.response
        .text()
        .replace(/^[\s\S]*?{/, "{")
        .replace(/}[\s\S]*$/, "}");

      try {
        const analysis: EmailAnalysis = JSON.parse(responseText);
        
        if (!analysis.category || !analysis.priority) {
          throw new Error("Invalid analysis format");
        }
        
        console.log(`✅ Email categorized: ${analysis.category} (${analysis.priority} priority)`);
        console.log(`📊 Confidence: ${analysis.confidence}% | Reply needed: ${analysis.needsReply}`);
        
        return analysis;
      } catch (parseError) {
        console.error(`❌ JSON parsing failed:`, parseError);
        throw new Error(`Failed to parse AI response: ${responseText.substring(0, 100)}...`);
      }
      
    } catch (error: any) {
      lastError = error;
      
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      
      if (error.message?.includes('rate limit') || error.message?.includes('quota')) {
        lastApiCallTime = Date.now();
        dailyApiCalls++;
        if (attempt === maxRetries) {
          throw new Error("Rate limit exceeded. Try again later.");
        }
        console.log(`⏳ Rate limit hit, retrying in ${attempt * 2}s...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
      } else {
        lastApiCallTime = Date.now();
        dailyApiCalls++;
        if (attempt === maxRetries) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  console.log(`⚠️ AI analysis failed after ${maxRetries} attempts, using fallback`);
  
  return {
    category: "Updates",
    priority: determineFallbackPriority(from, subject),
    needsReply: determineFallbackReply(from, subject),
    confidence: 30,
    analysis: `Fallback analysis due to API error: ${lastError?.message || 'Unknown error'}`,
    suggestedActions: ["Review manually"]
  };
}

function determineFallbackPriority(from: string, subject: string): "High" | "Medium" | "Low" {
  const lowerFrom = from.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  
  if (lowerSubject.includes('urgent') || lowerSubject.includes('important') || 
      lowerSubject.includes('interview') || lowerSubject.includes('job')) {
    return "High";
  }
  
  if (lowerFrom.includes('noreply') || lowerFrom.includes('no-reply') ||
      lowerSubject.includes('newsletter') || lowerSubject.includes('unsubscribe')) {
    return "Low";
  }
  
  return "Medium";
}

function determineFallbackReply(from: string, subject: string): boolean {
  const lowerFrom = from.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  
  if (lowerFrom.includes('noreply') || lowerFrom.includes('no-reply') ||
      lowerFrom.includes('automated') || lowerFrom.includes('system') ||
      lowerSubject.includes('newsletter') || lowerSubject.includes('unsubscribe')) {
    return false;
  }
  
  // Reply to potential opportunities
  if (lowerSubject.includes('interview') || lowerSubject.includes('job') ||
      lowerSubject.includes('opportunity') || lowerSubject.includes('meeting')) {
    return true;
  }
  
  return false;
}
