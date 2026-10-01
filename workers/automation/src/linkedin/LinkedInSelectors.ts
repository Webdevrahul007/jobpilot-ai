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

  // ── Job Search Results ────────────────────────────────────────────────────

  JOBS: {
    // The scrollable list panel on the left side of /jobs/search/
    RESULTS_LIST: '.jobs-search-results-list, .scaffold-layout__list',

    // Each individual job card in the results list
    JOB_CARD: 'li.jobs-search-results__list-item, li.scaffold-layout__list-item',

    // Job title link inside a card
    CARD_TITLE: 'a.job-card-list__title, a.job-card-container__link',

    // Company name inside a card
    CARD_COMPANY: '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle',

    // Location inside a card
    CARD_LOCATION: '.job-card-container__metadata-item, .artdeco-entity-lockup__caption',

    // "Easy Apply" badge on a card — presence = Easy Apply job
    CARD_EASY_APPLY_BADGE: '.job-card-container__apply-method, li-icon[type="linkedin-bug"]',

    // Salary shown on card (not always present)
    CARD_SALARY: '.job-card-container__salary-info',

    // "Remote" / "Hybrid" tag on card
    CARD_WORKPLACE_TYPE: '.job-card-container__metadata-wrapper .job-card-container__metadata-item--workplace-type',

    // Pagination: "Next" button at bottom of results
    PAGINATION_NEXT: 'button[aria-label="View next page"]',

    // Total result count shown above the list ("1,234 results")
    RESULT_COUNT: '.jobs-search-results-list__title-heading, h1.jobs-search-results-list__title',

    // Loading spinner — wait for this to disappear before scraping
    LOADING_SPINNER: '.jobs-search-results-list__loader',

    // No results message
    NO_RESULTS: '.jobs-search-no-results-banner',

    // ── Job Detail Panel (right side) ───────────────────────────────────────

    // Title in the detail panel
    DETAIL_TITLE: '.job-details-jobs-unified-top-card__job-title h1, h1.t-24',

    // Company name in detail panel
    DETAIL_COMPANY: '.job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name',

    // Location in detail panel
    DETAIL_LOCATION: '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',

    // Posted date in detail panel
    DETAIL_POSTED: '.job-details-jobs-unified-top-card__primary-description-container span[aria-hidden="true"]',

    // "Easy Apply" button in detail panel
    DETAIL_EASY_APPLY_BUTTON: 'button.jobs-apply-button',

    // "Apply" button (external — not Easy Apply)
    DETAIL_EXTERNAL_APPLY_BUTTON: 'button.jobs-apply-button--top-card',

    // Salary shown in detail panel
    DETAIL_SALARY: '.job-details-jobs-unified-top-card__job-insight span',
  },

  // ── Easy Apply Modal ──────────────────────────────────────────────────────

  EASY_APPLY: {
    // "Easy Apply" button on a job listing page
    BUTTON: 'button.jobs-apply-button:has-text("Easy Apply")',

    // Modal dialog that opens after clicking Easy Apply
    MODAL: '.jobs-easy-apply-content',

    // Modal header — shows current step title e.g. "Contact info", "Resume"
    MODAL_HEADER: 'h3.jobs-easy-apply-header',

    // "Next" button inside the modal — advances to next step
    NEXT_BUTTON: 'button[aria-label="Continue to next step"]',

    // "Review" button — second-to-last step
    REVIEW_BUTTON: 'button[aria-label="Review your application"]',

    // "Submit application" — final button
    SUBMIT_BUTTON: 'button[aria-label="Submit application"]',

    // Error summary shown when required fields are missing
    ERROR_SUMMARY: '.artdeco-inline-feedback--error',

    // "Dismiss" / close modal button
    CLOSE_BUTTON: 'button[aria-label="Dismiss"]',

    // Discard confirmation dialog that appears after clicking Dismiss
    DISCARD_CONFIRM_BUTTON: 'button[data-control-name="discard_application_confirm_btn"]',
  },

  // ── Post-submission success screen ────────────────────────────────────────

  SUBMIT_SUCCESS: {
    // Primary success heading — "Your application was sent to <Company>"
    HEADING: 'h2:has-text("application was sent"), h2:has-text("Application submitted"), .post-apply-timeline__entity-lockup',

    // Secondary confirmation inside the success panel
    CONFIRMATION: '.post-apply-timeline, .jobs-applied-confirmation',

    // "Done" button that closes the confirmation
    DONE_BUTTON: 'button[aria-label="Dismiss"], button:has-text("Done")',

    // "Save" prompt that sometimes follows submission ("Save this job for future reference")
    SAVE_PROMPT: '.post-apply-save-card',
  },

  // ── Resume Upload (inside Easy Apply modal) ───────────────────────────────

  RESUME: {
    // ── Upload scenarios ─────────────────────────────────────────────────

    // The file <input> that accepts the PDF — hidden, triggered by clicking label
    // LinkedIn uses multiple possible IDs/classes across UI versions
    FILE_INPUT: [
      'input[type="file"][name="file"]',
      'input[type="file"].jobs-document-upload__input',
      'input[type="file"][id*="resume"]',
      'input[type="file"][accept*="pdf"]',
    ].join(", "),

    // The upload button/label the user clicks — we use setInputFiles() directly
    // on the hidden input instead, but this locator confirms upload UI is present
    UPLOAD_LABEL: '.jobs-document-upload__upload-button, label[for*="resume"]',

    // Container that wraps the whole resume upload section
    UPLOAD_CONTAINER: '.jobs-document-upload, .resume-upload',

    // ── Existing resume scenarios ────────────────────────────────────────

    // Radio button: "Use previously uploaded resume" option
    USE_EXISTING_RADIO: 'input[name*="resume"][value*="existing"], label:has-text("Use")',

    // "Previously uploaded" card that shows the last uploaded resume
    EXISTING_RESUME_CARD: '.jobs-resume-upload-redesign__resume-card, .jobs-document-upload__resume-card',

    // The resume filename shown in the existing card
    EXISTING_RESUME_NAME: '.jobs-resume-upload-redesign__resume-name, .document-upload__file-name',

    // "Upload a different resume" / "Replace" link
    REPLACE_RESUME_LINK: 'button:has-text("Upload a different resume"), button:has-text("Replace"), a:has-text("Upload a different resume")',

    // ── Step identification ───────────────────────────────────────────────

    // Heading text that indicates we're on the resume step
    // LinkedIn calls it "Resume" or "Contact info" (which also has resume)
    RESUME_STEP_HEADING: 'h3:has-text("Resume"), h3:has-text("Contact info"), .jobs-easy-apply-header:has-text("Resume")',

    // ── Upload success / progress ─────────────────────────────────────────

    // Progress bar shown while file is uploading
    UPLOAD_PROGRESS: '.jobs-document-upload__upload-progress',

    // Success indicator after upload completes
    UPLOAD_SUCCESS: '.jobs-document-upload__upload-icon--done, .artdeco-inline-feedback--success',

    // Error shown if file type/size rejected
    UPLOAD_ERROR: '.jobs-document-upload__upload-error, .artdeco-inline-feedback--error',
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

/**
 * Build a LinkedIn jobs search URL with query params.
 *
 * f_AL=true  → Easy Apply filter
 * f_WT=2     → Remote jobs (1=On-site, 2=Remote, 3=Hybrid)
 * sortBy=DD  → Sort by "Most Recent" (DD = date descending)
 * start=N    → Pagination offset (25 per page)
 */
export function buildJobSearchUrl(params: {
  keywords: string;
  location?: string;
  easyApplyOnly?: boolean;
  remoteOnly?: boolean;
  start?: number;
}): string {
  const url = new URL(LinkedInUrls.JOBS_SEARCH);
  url.searchParams.set("keywords", params.keywords);
  if (params.location) url.searchParams.set("location", params.location);
  if (params.easyApplyOnly) url.searchParams.set("f_AL", "true");
  if (params.remoteOnly) url.searchParams.set("f_WT", "2");
  url.searchParams.set("sortBy", "DD"); // Most recent first
  if (params.start && params.start > 0) {
    url.searchParams.set("start", String(params.start));
  }
  return url.toString();
}
