/**
 * Human-like delay utilities.
 *
 * Fixed setTimeout is easy to fingerprint — a bot that always waits
 * exactly 1000ms between actions is detectable. Random ranges are harder
 * to distinguish from a human who takes 0.8–1.4s to read and click.
 */

/**
 * Wait a random number of ms between min and max.
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Short pause — between two fast sequential actions.
 * e.g. focus field → start typing
 */
export const shortDelay = () => randomDelay(300, 800);

/**
 * Medium pause — after filling a field, before moving to the next.
 * e.g. typed email → move to password
 */
export const mediumDelay = () => randomDelay(800, 1500);

/**
 * Long pause — after a navigation or button click that triggers a page load.
 * e.g. clicked Submit → wait for next page
 */
export const longDelay = () => randomDelay(2000, 4000);

/**
 * Type a string character by character with random per-key delays.
 * Mimics a human typing at ~60–100 WPM.
 */
export async function humanType(
  typeFn: (char: string) => Promise<void>,
  text: string
): Promise<void> {
  for (const char of text) {
    await typeFn(char);
    await randomDelay(50, 180);
  }
}
