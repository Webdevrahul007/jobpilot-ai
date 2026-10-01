import type { Locator, Page } from "playwright";
import { logger } from "../utils/logger.js";

/**
 * The types of form inputs LinkedIn uses in Easy Apply modals.
 */
export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file"
  | "unknown";

/**
 * A single detected form field inside an Easy Apply modal step.
 */
export interface DetectedField {
  label: string;          // Human-readable label text e.g. "Phone number"
  normalizedKey: string;  // snake_case key for AnswerResolver e.g. "phone_number"
  type: FieldType;
  locator: Locator;       // The actual input element to interact with
  options?: string[];     // For select / radio — the available choices
  required: boolean;
  currentValue: string;   // Pre-filled value, if any
  isAnswered: boolean;    // True if already has a non-empty value
}

/**
 * FieldDetector — inspects the current Easy Apply modal step and
 * returns a list of all interactive form fields with their metadata.
 *
 * LinkedIn renders form steps as a series of "form-component" divs,
 * each wrapping a label + one input element. This class normalises
 * all the different input types into a consistent DetectedField shape.
 */
export class FieldDetector {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Scan the current modal step and return all detectable fields.
   * Fields that are hidden, disabled, or already correctly filled
   * are still returned — the AnswerResolver decides whether to act.
   */
  async detectFields(): Promise<DetectedField[]> {
    // LinkedIn wraps each field in a div with class "jobs-easy-apply-form-section__grouping"
    // or "fb-dash-form-element". We scan both patterns.
    const fieldContainerSelectors = [
      ".jobs-easy-apply-form-section__grouping",
      ".fb-dash-form-element",
      ".jobs-easy-apply-form-element",
      // Fallback: any label+input pair inside the modal
      ".jobs-easy-apply-content .artdeco-text-input--container",
    ];

    const allFields: DetectedField[] = [];
    const seen = new Set<string>(); // dedup by label to avoid double-processing

    for (const containerSel of fieldContainerSelectors) {
      const containers = await this.page.locator(containerSel).all();

      for (const container of containers) {
        try {
          const field = await this.extractField(container);
          if (field && !seen.has(field.normalizedKey)) {
            seen.add(field.normalizedKey);
            allFields.push(field);
          }
        } catch {
          // Skip un-parseable fields — don't break the whole step
        }
      }
    }

    logger.debug(`Detected ${allFields.length} fields on current modal step`);
    return allFields;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async extractField(container: Locator): Promise<DetectedField | null> {
    // ── Get label ─────────────────────────────────────────────────────────
    const label = await this.extractLabel(container);
    if (!label) return null;

    const normalizedKey = normalizeLabel(label);

    // ── Detect input type ─────────────────────────────────────────────────

    // Radio group
    const radios = await container.locator('input[type="radio"]').all();
    if (radios.length > 0) {
      const options = await this.extractRadioOptions(container);
      const currentValue = await this.getCheckedRadioValue(container);
      return {
        label,
        normalizedKey,
        type: "radio",
        locator: container.locator('input[type="radio"]').first(),
        options,
        required: await this.isRequired(container),
        currentValue,
        isAnswered: currentValue !== "",
      };
    }

    // Select / dropdown
    const select = container.locator("select").first();
    if (await select.count() > 0) {
      const options = await this.extractSelectOptions(select);
      const currentValue = await select.inputValue().catch(() => "");
      return {
        label,
        normalizedKey,
        type: "select",
        locator: select,
        options,
        required: await this.isRequired(container),
        currentValue,
        isAnswered: currentValue !== "" && currentValue !== "Select an option",
      };
    }

    // Checkbox
    const checkbox = container.locator('input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      const checked = await checkbox.isChecked().catch(() => false);
      return {
        label,
        normalizedKey,
        type: "checkbox",
        locator: checkbox,
        required: await this.isRequired(container),
        currentValue: checked ? "true" : "false",
        isAnswered: true, // checkboxes always have a state
      };
    }

    // Textarea
    const textarea = container.locator("textarea").first();
    if (await textarea.count() > 0) {
      const currentValue = await textarea.inputValue().catch(() => "");
      return {
        label,
        normalizedKey,
        type: "textarea",
        locator: textarea,
        required: await this.isRequired(container),
        currentValue,
        isAnswered: currentValue.trim() !== "",
      };
    }

    // File input (resume upload — handled by Phase 5, skip here)
    const fileInput = container.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      return {
        label,
        normalizedKey,
        type: "file",
        locator: fileInput,
        required: false,
        currentValue: "",
        isAnswered: true, // Phase 5 already handled this
      };
    }

    // Text / number / email / tel inputs
    const textInput = container
      .locator('input[type="text"], input[type="number"], input[type="email"], input[type="tel"], input:not([type])')
      .first();
    if (await textInput.count() > 0) {
      const currentValue = await textInput.inputValue().catch(() => "");
      return {
        label,
        normalizedKey,
        type: "text",
        locator: textInput,
        required: await this.isRequired(container),
        currentValue,
        isAnswered: currentValue.trim() !== "",
      };
    }

    return null; // No recognisable input found
  }

  private async extractLabel(container: Locator): Promise<string> {
    // Try explicit label element first
    const labelSelectors = [
      "label",
      ".artdeco-text-input--label",
      ".fb-dash-form-element__label",
      "legend", // used for radio groups
      ".jobs-easy-apply-form-section__label",
    ];

    for (const sel of labelSelectors) {
      const el = container.locator(sel).first();
      if (await el.count() > 0) {
        const text = await el.textContent().catch(() => "");
        const cleaned = text?.replace(/\*/g, "").trim() ?? "";
        if (cleaned) return cleaned;
      }
    }

    // Fallback: aria-label on the input itself
    const inputs = container.locator("input, select, textarea").first();
    const ariaLabel = await inputs.getAttribute("aria-label").catch(() => null);
    if (ariaLabel) return ariaLabel.trim();

    return "";
  }

  private async extractRadioOptions(container: Locator): Promise<string[]> {
    const labels = await container
      .locator('input[type="radio"] + label, .fb-radio-button label, .artdeco-radio-button label')
      .allTextContents()
      .catch(() => [] as string[]);

    if (labels.length > 0) return labels.map((l) => l.trim()).filter(Boolean);

    // Fallback: get value attributes
    const radios = await container.locator('input[type="radio"]').all();
    const values: string[] = [];
    for (const r of radios) {
      const val = await r.getAttribute("value").catch(() => null);
      if (val) values.push(val);
    }
    return values;
  }

  private async getCheckedRadioValue(container: Locator): Promise<string> {
    const checked = container.locator('input[type="radio"]:checked').first();
    if (await checked.count() === 0) return "";
    return await checked.getAttribute("value").catch(() => "") ?? "";
  }

  private async extractSelectOptions(select: Locator): Promise<string[]> {
    return select
      .locator("option")
      .allTextContents()
      .then((opts) =>
        opts
          .map((o) => o.trim())
          .filter((o) => o && o.toLowerCase() !== "select an option")
      )
      .catch(() => []);
  }

  private async isRequired(container: Locator): Promise<boolean> {
    // Check for asterisk in label
    const labelText = await container
      .locator("label, legend")
      .first()
      .textContent()
      .catch(() => "");
    if (labelText?.includes("*")) return true;

    // Check required attribute on input
    const input = container.locator("input, select, textarea").first();
    const required = await input.getAttribute("required").catch(() => null);
    return required !== null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a field label to a snake_case key for consistent lookup.
 * "Phone number" → "phone_number"
 * "Years of experience" → "years_of_experience"
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")   // strip special chars
    .trim()
    .replace(/\s+/g, "_");          // spaces → underscores
}
