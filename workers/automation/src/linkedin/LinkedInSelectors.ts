/**
 * LinkedIn CSS Selectors — single source of truth.
 *
 * MAINTENANCE GUIDE:
 * When LinkedIn updates their UI, selectors break here first.
 * Fix here → everything works again. Never hardcode selectors elsewhere.
 *
 * Each selector has a comment explaining what it targets and how to
 * find it again if LinkedIn changes it.
 */
export const LinkedInSelectors = {
  // ── Login Page ─────────────────────────────────────────────────────────────

  LOGIN: {
    // Email input on /login page
    EMAIL_INPUT: '#username',

    // Password input on /login page
    PASSWORD_INPUT: '#password',

    // "Sign in" submit button
    SUBMIT_BUTTON: 'button[type="submit"][data-litms-control-urn="login-submit"]',

    // Fallback submit button selector (LinkedIn sometimes changes the data attribute)
    SUBMIT_BUTTON_FALLBACK: 'button[type="submit"]',

    // Error message shown for wrong credentials
    ERROR_MESSAGE: '#error-for-username, #error-for-password, .alert-content',

    // "Verification required" challenge container
    CAPTCHA_CONTAINER: '#captcha-internal, .recaptcha-checkbox',

    // Phone/email verification challenge
    VERIFICATION_CHALLENGE: '#email-pin-challenge, .challenge-dialog',
  },

  // ── Post-login / Feed ──────────────────────────────────────────────────────

  FEED: {
    // Global nav — only present when logged in
    // Most reliable logged-in indicator (doesn't change often)
    GLOBAL_NAV: 'nav.global-nav, #global-nav',

    // Profile picture in nav — confirms identity
    PROFILE_NAV_ITEM: '.global-nav__me',

    // "Start a post" prompt on feed — present on feed only
    POST_PROMPT: '.share-box-feed-entry__trigger',
  },

  // ── Profile ────────────────────────────────────────────────────────────────

  PROFILE: {
    // Name on the profile page /in/username
    NAME: 'h1.text-heading-xlarge',

    // "Open to Work" banner
    OPEN_TO_WORK: '.pv-open-to-opportunities-banner',
  },

  // ── Security / Challenge ───────────────────────────────────────────────────

  SECURITY: {
    // "Let's do a quick security check" heading
    SECURITY_CHECK: 'h1:has-text("security"), h1:has-text("verification")',

    // "Check your email" verification page
    EMAIL_VERIFY_HEADING: 'h1:has-text("Check your email")',

    // "Enter the code" PIN input
    PIN_INPUT: 'input#input__email_verification_pin',
  },

  // ── Easy Apply (Phase 4+) ──────────────────────────────────────────────────

  EASY_APPLY: {
    // "Easy Apply" button on a job listing page
    BUTTON: 'button.jobs-apply-button:has-text("Easy Apply")',

    // Modal dialog that opens after clicking Easy Apply
    MODAL: '.jobs-easy-apply-content',

    // "Next" button inside the modal
    NEXT_BUTTON: 'button[aria-label="Continue to next step"]',

    // "Review" button (second-to-last step)
    REVIEW_BUTTON: 'button[aria-label="Review your application"]',

    // "Submit application" final button
    SUBMIT_BUTTON: 'button[aria-label="Submit application"]',

    // Error summary shown when required fields are missing
    ERROR_SUMMARY: '.artdeco-inline-feedback--error',

    // Close/discard modal button
    CLOSE_BUTTON: 'button[aria-label="Dismiss"]',
  },
} as const;

// LinkedIn URLs — centralised here alongside selectors
export const LinkedInUrls = {
  BASE: "https://www.linkedin.com",
  LOGIN: "https://www.linkedin.com/login",
  FEED: "https://www.linkedin.com/feed/",
  JOBS_SEARCH: "https://www.linkedin.com/jobs/search/",
  CHECKPOINT: "https://www.linkedin.com/checkpoint",
} as const;
