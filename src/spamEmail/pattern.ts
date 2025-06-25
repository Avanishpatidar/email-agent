import path from "path";
import { promises as fs } from "fs";

async function getIgnorePatterns(): Promise<string[]> {
  const ignorePatternPath = path.join(process.cwd(), "src/spamEmail", "ignore_patterns.json");

  try {
    const content = await fs.readFile(ignorePatternPath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.error("Error reading ignore patterns:", err);
    return [];
  }
}

function classifyEmailType(emailFrom: string, subject: string, content: string): "spam" | "promotional" | "social" | "newsletter" | "legitimate" {
  const lowerFrom = emailFrom.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const lowerContent = content.toLowerCase();

  const spamIndicators = [
    'free money', 'click here now', 'urgent action required', 'act now',
    'congratulations you won', 'you are a winner', 'claim your prize',
    'nigerian prince', 'inheritance', 'lottery winner'
  ];

  const promotionalIndicators = [
    'unsubscribe', 'sale', 'discount', 'limited time', 'offer',
    'deal', 'coupon', 'promo', 'special offer', 'save money'
  ];

  const socialIndicators = [
    'facebook', 'twitter', 'instagram', 'linkedin', 'social',
    'friend request', 'tagged you', 'mentioned you'
  ];

  const newsletterIndicators = [
    'newsletter', 'weekly update', 'monthly digest', 'blog post',
    'article', 'news', 'digest', 'roundup'
  ];

  if (spamIndicators.some(indicator => lowerContent.includes(indicator) || lowerSubject.includes(indicator))) {
    return "spam";
  }

  if (promotionalIndicators.some(indicator => lowerContent.includes(indicator) || lowerSubject.includes(indicator))) {
    return "promotional";
  }

  if (socialIndicators.some(indicator => lowerFrom.includes(indicator) || lowerSubject.includes(indicator))) {
    return "social";
  }

  if (newsletterIndicators.some(indicator => lowerSubject.includes(indicator) || lowerContent.includes(indicator))) {
    return "newsletter";
  }

  return "legitimate";
}

function shouldIgnoreEmail(emailFrom: string, subject?: string, content?: string): Promise<boolean> {
  return (async () => {
    const ignoreDomains: string[] = (await getIgnorePatterns()) || [];
    
    const senderMatch = ignoreDomains.some((pattern) => 
      emailFrom.toLowerCase().includes(pattern.toLowerCase())
    );
    
    if (senderMatch) return true;
    
    if (subject && content) {
      const emailType = classifyEmailType(emailFrom, subject, content);
      
      if (emailType === "spam") {
        console.log(`→ Classified as SPAM: ${emailType}`);
        return true;
      }
      
      
    }
    
    if (subject) {
      const spamSubjectPatterns = [
        'winner', 'congratulations', 'claim your', 'urgent action',
        'final notice', 'act now', 'limited time', 'expire'
      ];
      
      const subjectMatch = spamSubjectPatterns.some(pattern => 
        subject.toLowerCase().includes(pattern)
      );
      
      if (subjectMatch) return true;
    }
    
    if (content) {
      const definiteSpamPatterns = [
        'click here now', 'free money', 'nigerian prince',
        'you have won', 'claim your prize', 'inheritance fund'
      ];
      
      const contentLower = content.toLowerCase();
      const contentMatch = definiteSpamPatterns.some(pattern => 
        contentLower.includes(pattern)
      );
      
      if (contentMatch) return true;
    }
    
    return false;
  })();
}

async function updateIgnoreList(newPatterns: string[]): Promise<string[]> {
  try {
    const ignorePatternsPath = path.join(process.cwd(), "src/spamEmail", "ignore_patterns.json");

    let currentPatterns: string[] = [];
    try {
      const content = await fs.readFile(ignorePatternsPath, "utf8");
      currentPatterns = JSON.parse(content);
    } catch (err) {
      await fs.writeFile(ignorePatternsPath, JSON.stringify(newPatterns, null, 2));
      console.log("> New ignored patterns file created:", ignorePatternsPath);
    }

    const updatedPatterns = [...new Set([...currentPatterns, ...newPatterns])];
    await fs.writeFile(ignorePatternsPath, JSON.stringify(updatedPatterns, null, 2));

    console.log("> Updated ignore patterns:", updatedPatterns);
    return updatedPatterns;
  } catch (error) {
    console.error("Error updating ignore patterns:", error);
    throw error;
  }
}

export { getIgnorePatterns, shouldIgnoreEmail, updateIgnoreList, classifyEmailType };
