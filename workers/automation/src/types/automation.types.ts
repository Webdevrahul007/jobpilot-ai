import type { BrowserContext, Page } from "playwright";

export interface BrowserConfig {
  headless: boolean;
  slowMo: number;         // ms delay between actions — makes bot look human
  sessionDir: string;     // where storageState JSON files are saved
}

export interface LaunchOptions {
  storageStatePath?: string;   // path to a saved storageState JSON file
  headless?: boolean;          // override config default
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface LoginResult {
  success: boolean;
  sessionData?: StorageState;
  error?: string;
}

export interface SessionCheckResult {
  isLoggedIn: boolean;
  username?: string;
}
