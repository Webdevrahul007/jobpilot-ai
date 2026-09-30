import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import path from "path";
import fs from "fs";
import type { BrowserConfig, LaunchOptions, BrowserSession } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";

/**
 * BrowserManager — owns the Playwright Browser lifecycle.
 *
 * Responsibilities:
 * - Launch Chromium with anti-detection flags
 * - Create new browser contexts (optionally pre-loaded with a saved session)
 * - Tear down contexts and the browser cleanly
 *
 * Design: one BrowserManager instance per worker process.
 * Each application attempt gets its own BrowserContext so they're isolated.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private readonly config: BrowserConfig;

  constructor(config: BrowserConfig) {
    this.config = config;
    this.ensureSessionDir();
  }

  // ── Launch ─────────────────────────────────────────────────────────────────

  async launch(): Promise<void> {
    if (this.browser?.isConnected()) return;

    logger.info("Launching Chromium browser", {
      headless: this.config.headless,
    });

    this.browser = await chromium.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
      args: this.getChromiumArgs(),
    });

    logger.info("Browser launched");
  }

  // ── Create context ─────────────────────────────────────────────────────────

  /**
   * Creates a new isolated BrowserContext.
   * If storageStatePath is provided and the file exists, loads saved
   * cookies/localStorage so the session is pre-authenticated.
   */
  async newSession(options: LaunchOptions = {}): Promise<BrowserSession> {
    if (!this.browser?.isConnected()) {
      await this.launch();
    }

    const browser = this.browser!;

    const contextOptions: NonNullable<Parameters<typeof browser.newContext>[0]> = {
      viewport: { width: 1280, height: 800 },
      userAgent: this.getRealisticUserAgent(),
      locale: "en-US",
      timezoneId: "Asia/Kolkata",
      geolocation: { latitude: 12.9716, longitude: 77.5946 }, // Bangalore
      permissions: ["geolocation"],
      // Prevent navigator.webdriver from being true
      javaScriptEnabled: true,
      // Don't load images in headless — faster, less bandwidth
      ...(this.config.headless && {
        extraHTTPHeaders: { Accept: "text/html,application/xhtml+xml" },
      }),
    };

    // If a session file exists, pre-load it into the context
    if (options.storageStatePath && fs.existsSync(options.storageStatePath)) {
      logger.info("Loading saved session state", {
        path: options.storageStatePath,
      });
      contextOptions.storageState = options.storageStatePath;
    }

    const context = await browser.newContext(contextOptions);

    // Inject anti-detection scripts into every page in this context
    await this.injectAntiDetection(context);

    const page = await context.newPage();

    // Block unnecessary resource types to speed up navigation
    await this.setupRequestInterception(page);

    logger.info("New browser session created");
    return { context, page };
  }

  // ── Close ──────────────────────────────────────────────────────────────────

  async closeSession(session: BrowserSession): Promise<void> {
    try {
      await session.context.close();
      logger.info("Browser session closed");
    } catch (err) {
      logger.warn("Error closing browser session", { err });
    }
  }

  async closeBrowser(): Promise<void> {
    try {
      await this.browser?.close();
      this.browser = null;
      logger.info("Browser closed");
    } catch (err) {
      logger.warn("Error closing browser", { err });
    }
  }

  // ── Session state path ─────────────────────────────────────────────────────

  getSessionFilePath(userId: string): string {
    return path.join(this.config.sessionDir, `session_${userId}.json`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Chromium launch args that reduce bot-detection signals.
   *
   * Key ones:
   * --disable-blink-features=AutomationControlled  → removes navigator.webdriver
   * --no-sandbox                                   → required in Docker
   * --disable-dev-shm-usage                        → prevents OOM in Docker
   */
  private getChromiumArgs(): string[] {
    return [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-setuid-sandbox",
      "--no-first-run",
      "--no-zygote",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-default-browser-check",
      "--safebrowsing-disable-auto-update",
      "--window-size=1280,800",
    ];
  }

  /**
   * Inject JavaScript into every page before any other script runs.
   * This overwrites the properties that headless Chrome exposes.
   */
  private async injectAntiDetection(context: BrowserContext): Promise<void> {
    // NOTE: This function is serialised and injected into the browser page.
    // It runs in browser scope — not Node scope. All browser globals
    // (window, Notification, etc.) are accessed via explicit unknown casts
    // to satisfy the Node TypeScript compiler while keeping correct runtime behaviour.
    await context.addInitScript(() => {
      // Remove the webdriver property
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });

      // Spoof plugins array — real Chrome has plugins, headless has none
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });

      // Spoof languages
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      // Chrome runtime object — headless Chrome doesn't have it
      const win = globalThis as Record<string, unknown>;
      win["chrome"] = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };

      // Spoof permissions query
      const nav = globalThis.navigator as unknown as {
        permissions: { query: (p: unknown) => Promise<unknown> };
      };
      const originalQuery = nav.permissions.query.bind(nav.permissions);
      nav.permissions.query = (parameters: unknown) => {
        const notif = globalThis as unknown as { Notification: { permission: string } };
        if ((parameters as { name?: string })?.name === "notifications") {
          return Promise.resolve({ state: notif.Notification?.permission ?? "default" });
        }
        return originalQuery(parameters);
      };
    });
  }

  /**
   * Block resource types that slow down page loads without adding value
   * for automation (fonts, media, tracking pixels).
   */
  private async setupRequestInterception(page: Page): Promise<void> {
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();

      // Block analytics and tracking
      const blockedDomains = [
        "google-analytics.com",
        "googletagmanager.com",
        "doubleclick.net",
        "facebook.com/tr",
        "hotjar.com",
      ];

      const isBlocked =
        resourceType === "media" ||
        resourceType === "font" ||
        blockedDomains.some((domain) => url.includes(domain));

      if (isBlocked) {
        route.abort().catch(() => null);
      } else {
        route.continue().catch(() => null);
      }
    });
  }

  private getRealisticUserAgent(): string {
    // Pinned Chrome 128 on Linux — matches the Chromium version we installed
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  }

  private ensureSessionDir(): void {
    if (!fs.existsSync(this.config.sessionDir)) {
      fs.mkdirSync(this.config.sessionDir, { recursive: true });
    }
  }
}
