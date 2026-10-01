import { normalizeLabel, type DetectedField } from "./FieldDetector.js";
import { logger } from "../utils/logger.js";

/**
 * The user's profile data used to fill form fields.
 * Mirrors the UserProfile Prisma model — kept as a plain object
 * so the automation package has no Prisma dependency.
 */
export interface UserProfileData {
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  country: string;
  linkedinUrl?: string;
  totalYearsExp: number;
  currentJobTitle?: string;
  noticePeriodDays: number;
  expectedSalary?: number;
  currency: string;
  visaRequired: boolean;
  resumeFileName: string;
}

/**
 * A previous answer to a specific question — fetched from FormAnswer table.
 * Key is the normalizedKey from FieldDetector.
 */
export type StoredAnswers = Record<string, string>;

/**
 * AnswerResolver — maps a detected form field to the correct answer string.
 *
 * Resolution priority (highest → lowest):
 * 1. StoredAnswer from DB (from a previous run on any job)
 * 2. UserProfile data matched by field label keywords
 * 3. Sensible defaults (e.g. "No" for visa sponsorship, "0" for unknown numbers)
 * 4. Empty string (field left blank — will trigger validation error on submit)
 *
 * Adding a new field: add a keyword match in resolveFromProfile().
 * No other file needs to change.
 */
export class AnswerResolver {
  private readonly profile: UserProfileData;
  private readonly stored: StoredAnswers;

  constructor(profile: UserProfileData, stored: StoredAnswers = {}) {
    this.profile = profile;
    this.stored = stored;
  }

  /**
   * Returns the best answer for the given field, or null if the field
   * should be left untouched (already answered, file input, etc.).
   */
  resolve(field: DetectedField): string | null {
    // Skip file inputs — Phase 5 handles those
    if (field.type === "file") return null;

    // Skip already-answered fields
    if (field.isAnswered && field.type !== "radio") return null;

    const key = field.normalizedKey;
    const label = field.label.toLowerCase();

    // ── 1. Stored answer from previous runs ──────────────────────────────
    if (this.stored[key] !== undefined) {
      logger.debug("Using stored answer", { key, answer: this.stored[key] });
      return this.stored[key]!;
    }

    // ── 2. Match from profile ─────────────────────────────────────────────
    const profileAnswer = this.resolveFromProfile(label, field);
    if (profileAnswer !== null) {
      logger.debug("Using profile answer", { key, label, answer: profileAnswer });
      return profileAnswer;
    }

    // ── 3. Defaults ───────────────────────────────────────────────────────
    const defaultAnswer = this.resolveDefault(label, field);
    if (defaultAnswer !== null) {
      logger.debug("Using default answer", { key, label, answer: defaultAnswer });
      return defaultAnswer;
    }

    // ── 4. Nothing found ──────────────────────────────────────────────────
    logger.warn("No answer found for field", { key, label, type: field.type });
    return null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private resolveFromProfile(
    label: string,
    field: DetectedField
  ): string | null {
    const p = this.profile;

    // ── Identity ─────────────────────────────────────────────────────────
    if (matches(label, ["first name", "firstname"])) return p.firstName;
    if (matches(label, ["last name", "lastname", "surname"])) return p.lastName;
    if (matches(label, ["full name", "your name"])) return `${p.firstName} ${p.lastName}`;

    // ── Contact ───────────────────────────────────────────────────────────
    if (matches(label, ["phone", "mobile", "contact number", "cell"])) return p.phone;
    if (matches(label, ["city", "current city", "location"])) return p.city;
    if (matches(label, ["country"])) return p.country;
    if (matches(label, ["linkedin", "linkedin url", "linkedin profile"])) {
      return p.linkedinUrl ?? `https://www.linkedin.com/in/${p.firstName.toLowerCase()}-${p.lastName.toLowerCase()}`;
    }

    // ── Experience ────────────────────────────────────────────────────────
    if (
      matches(label, [
        "years of experience",
        "total experience",
        "work experience",
        "experience in years",
        "how many years",
        "years experience",
      ])
    ) {
      return this.matchClosestOption(String(p.totalYearsExp), field.options);
    }

    if (matches(label, ["current job title", "current title", "current role", "designation"])) {
      return p.currentJobTitle ?? "";
    }

    // ── Salary ────────────────────────────────────────────────────────────
    if (
      matches(label, [
        "expected salary",
        "expected ctc",
        "desired salary",
        "salary expectation",
        "current ctc",
        "expected compensation",
      ])
    ) {
      return p.expectedSalary ? String(p.expectedSalary) : "";
    }

    // ── Notice period ─────────────────────────────────────────────────────
    if (matches(label, ["notice period", "availability", "joining time", "start date"])) {
      const weeks = Math.ceil(p.noticePeriodDays / 7);
      const answer = p.noticePeriodDays === 0 ? "Immediately" : `${weeks} weeks`;
      return this.matchClosestOption(answer, field.options) ?? answer;
    }

    // ── Visa / sponsorship ────────────────────────────────────────────────
    if (
      matches(label, [
        "visa",
        "sponsorship",
        "work authorization",
        "work permit",
        "require sponsorship",
        "need sponsorship",
        "authorized to work",
      ])
    ) {
      // "Do you require sponsorship?" → No (if visaRequired = false)
      // "Are you authorized to work?" → Yes (if visaRequired = false)
      const requiresSponsor = p.visaRequired;
      const isAuthorizationQuestion = matches(label, ["authorized", "authorised", "legally"]);

      if (isAuthorizationQuestion) {
        return this.matchClosestOption(requiresSponsor ? "No" : "Yes", field.options);
      }
      return this.matchClosestOption(requiresSponsor ? "Yes" : "No", field.options);
    }

    // ── Remote / relocation ───────────────────────────────────────────────
    if (matches(label, ["willing to relocate", "relocate", "open to relocation"])) {
      return this.matchClosestOption("Yes", field.options);
    }

    if (matches(label, ["remote", "work from home", "open to remote"])) {
      return this.matchClosestOption("Yes", field.options);
    }

    // ── Education ─────────────────────────────────────────────────────────
    if (matches(label, ["highest education", "qualification", "degree", "education level"])) {
      return this.matchClosestOption("Bachelor", field.options);
    }

    // ── Gender / diversity (optional fields) ──────────────────────────────
    if (matches(label, ["gender", "pronouns"])) {
      return this.matchClosestOption("Prefer not to say", field.options) ?? "";
    }

    if (matches(label, ["veteran", "disability", "ethnicity", "race"])) {
      return this.matchClosestOption("Prefer not to say", field.options) ?? "";
    }

    return null;
  }

  /**
   * Sensible defaults for fields that aren't in the profile.
   */
  private resolveDefault(
    label: string,
    field: DetectedField
  ): string | null {
    // Yes/No fields — default to "Yes" for positive questions
    if (field.type === "radio" || field.type === "select") {
      if (matches(label, ["agree", "confirm", "acknowledge", "certify"])) {
        return this.matchClosestOption("Yes", field.options);
      }
      // For selects/radios with options, pick first non-empty option as safe default
      if (field.options && field.options.length > 0) {
        return field.options[0] ?? null;
      }
    }

    // Numeric fields default to "0"
    if (field.type === "text" && matches(label, ["years", "months", "number of"])) {
      return "0";
    }

    return null;
  }

  /**
   * Given a preferred value and a list of available options, return the
   * closest matching option (case-insensitive, partial match).
   *
   * "3"      + ["0-1", "1-3", "3-5", "5+"] → "3-5"
   * "Yes"    + ["Yes", "No"]                → "Yes"
   * "weeks"  + ["0-2 weeks", "1 month"]     → "0-2 weeks"
   */
  private matchClosestOption(
    preferred: string,
    options?: string[]
  ): string | null {
    if (!options || options.length === 0) return preferred;

    const lowerPreferred = preferred.toLowerCase();

    // Exact match
    const exact = options.find((o) => o.toLowerCase() === lowerPreferred);
    if (exact) return exact;

    // Partial match — preferred contained in option
    const partial = options.find((o) =>
      o.toLowerCase().includes(lowerPreferred)
    );
    if (partial) return partial;

    // Partial match — option contained in preferred
    const reverse = options.find((o) =>
      lowerPreferred.includes(o.toLowerCase())
    );
    if (reverse) return reverse;

    // For numeric values, find the range that contains our number
    const num = parseFloat(preferred);
    if (!isNaN(num)) {
      for (const opt of options) {
        const rangeMatch = opt.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (rangeMatch) {
          const lo = parseInt(rangeMatch[1]!, 10);
          const hi = parseInt(rangeMatch[2]!, 10);
          if (num >= lo && num <= hi) return opt;
        }
        // "5+" style
        const plusMatch = opt.match(/(\d+)\+/);
        if (plusMatch && num >= parseInt(plusMatch[1]!, 10)) return opt;
      }
    }

    // No match — return first option as fallback
    return options[0] ?? null;
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Check if a label contains any of the given keywords (case-insensitive).
 */
function matches(label: string, keywords: string[]): boolean {
  return keywords.some((kw) => label.includes(kw.toLowerCase()));
}
