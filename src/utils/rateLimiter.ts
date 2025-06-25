
export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private timeWindow: number;
  private dailyLimit: number;
  private dailyUsage: number = 0;
  private lastResetDate: string;

  constructor(maxRequests: number, timeWindowMs: number, dailyLimit: number) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindowMs;
    this.dailyLimit = dailyLimit;
    this.lastResetDate = new Date().toDateString();
  }

  /**
   * Check if we can make a request and enforce rate limits
   */
  async canMakeRequest(): Promise<boolean> {
    this.resetDailyCounterIfNeeded();
    
    const now = Date.now();
    
    // Remove old requests outside the time window
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    // Check daily limit
    if (this.dailyUsage >= this.dailyLimit) {
      console.warn(`⚠️ Daily API limit reached (${this.dailyLimit}). Skipping request.`);
      return false;
    }
    
    // Check rate limit
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    
    return true;
  }

  /**
   * Record a successful API request
   */
  recordRequest(): void {
    const now = Date.now();
    this.requests.push(now);
    this.dailyUsage++;
  }

  /**
   * Get time until next request can be made
   */
  getTimeUntilNextRequest(): number {
    if (this.requests.length < this.maxRequests) {
      return 0;
    }
    
    const oldestRequest = Math.min(...this.requests);
    const timeUntilOldestExpires = this.timeWindow - (Date.now() - oldestRequest);
    
    return Math.max(0, timeUntilOldestExpires);
  }

  /**
   * Wait for rate limit to allow next request
   */
  async waitForAvailability(): Promise<void> {
    const waitTime = this.getTimeUntilNextRequest();
    
    if (waitTime > 0) {
      console.log(`⏳ Rate limit hit. Waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime + 100)); // Add small buffer
    }
  }

  /**
   * Execute a request with automatic rate limiting
   */
  async executeWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we can make request
    if (!(await this.canMakeRequest())) {
      await this.waitForAvailability();
    }
    
    try {
      const result = await fn();
      this.recordRequest();
      return result;
    } catch (error) {
      // Still record the request even if it failed (to avoid quota violations)
      this.recordRequest();
      throw error;
    }
  }

  /**
   * Get current usage statistics
   */
  getUsageStats(): {
    currentRequests: number;
    maxRequests: number;
    dailyUsage: number;
    dailyLimit: number;
    timeUntilReset: number;
  } {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    const nextReset = this.requests.length > 0 
      ? Math.max(0, this.timeWindow - (now - Math.min(...this.requests)))
      : 0;
    
    return {
      currentRequests: this.requests.length,
      maxRequests: this.maxRequests,
      dailyUsage: this.dailyUsage,
      dailyLimit: this.dailyLimit,
      timeUntilReset: nextReset
    };
  }

  /**
   * Check if non-essential analysis should be skipped to preserve quota
   */
  shouldSkipNonEssential(): boolean {
    this.resetDailyCounterIfNeeded();
    
    // Skip if we're getting close to daily limit (80% threshold)
    const dailyUsagePercentage = (this.dailyUsage / this.dailyLimit) * 100;
    
    if (dailyUsagePercentage > 80) {
      console.warn(`⚠️ Daily quota at ${dailyUsagePercentage.toFixed(1)}% - skipping non-essential analysis`);
      return true;
    }
    
    return false;
  }

  /**
   * Wait if needed based on rate limits
   */
  async waitIfNeeded(): Promise<void> {
    if (!(await this.canMakeRequest())) {
      await this.waitForAvailability();
    }
  }

  /**
   * Record a successful API call
   */
  onSuccess(): void {
    this.recordRequest();
    console.log(`✅ API call successful. Daily usage: ${this.dailyUsage}/${this.dailyLimit}`);
  }

  /**
   * Record a failed API call
   */
  onError(): void {
    this.recordRequest(); // Still count failed requests toward quota
    console.log(`❌ API call failed. Daily usage: ${this.dailyUsage}/${this.dailyLimit}`);
  }

  private resetDailyCounterIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyUsage = 0;
      this.lastResetDate = today;
      console.log(`🔄 Daily API usage counter reset for ${today}`);
    }
  }
}

// Export the class to ensure this file is treated as a module
export default RateLimiter;
