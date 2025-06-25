import path from "path";
import process from "process";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import dotenv from "dotenv";

import { authorize } from "./config/config";
import { updateIgnoreList } from "./spamEmail/pattern";
import { processNewEmails } from "./emailProcess/email";

dotenv.config();

export const SCOPES: string[] = ["https://www.googleapis.com/auth/gmail.modify"];
export const CREDENTIALS_PATH: string = path.join(process.cwd(), "credentials.json");
export const TOKEN_PATH: string = path.join(process.cwd(), "tokens", "token.json");
export const CHECK_POST_CURRENT_TIME: boolean = false;
export const MAX_MAIL: number = 15; 
export const SENDERS_NAME: string = "Avanish Patidar";
export const INTERVAL: number = 2 * 60 * 1000; 

const apiKey: string = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);
const GEMINI_MODEL = ["gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro"];
export const model: GenerativeModel = genAI.getGenerativeModel({ 
  model: GEMINI_MODEL[0], 
  generationConfig: {
    temperature: 0.7,
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 5000, 
  }
});

// Main execution
async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set in environment variables");
    process.exit(1);
  }

  try {
    const auth = await authorize();

    console.log("\n> Smart Email Assistant started (Gemini 2.0 Flash-Lite)...");
    console.log("> Checking for new emails every 12 minutes");
    console.log("> Rate limit: 30 RPM free tier (2.5 calls/minute sustained)");
    console.log("> Using gemini-2.0-flash-lite for ultra-fast processing");
    console.log("> Processing max 8 emails per check with intelligent batching");
    console.log("> Advanced AI analysis with native tool use and streaming");
    console.log("> Smart rate limiting to stay within daily quota (1500/day)");
    console.log("> Processing max 10 emails per check with 15-second delays");
    console.log("> Creating SMART drafts only for emails that truly need replies");

    await updateIgnoreList(["noreply@glassdoor.com", "noreply@reddit.com"]);
    await processNewEmails(auth);   

    console.log("\n--- Checking emails every 10 minutes (Smart Draft Mode) ---");

    const intervalId = setInterval(async () => {
      console.log("\n--- Checking for new emails ---");

      await processNewEmails(auth);

      console.log("\n--- Next check in 10 minutes ---");
    }, INTERVAL);

    setTimeout(() => {
      clearInterval(intervalId);
      console.log("> Smart Email Assistant stopped after 30 minutes.");
    }, 30 * 60 * 1000);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Error handling
process.on("SIGINT", () => {
  console.log("\n> Smart Email Assistant stopped!");
  process.exit();
});

process.on("unhandledRejection", (error: Error) => {
  console.error("Unhandled rejection:", error);
});

main();
