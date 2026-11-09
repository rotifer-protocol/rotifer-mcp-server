const CONTROL_OR_SPACE = /[\u0000- \u007f-\u009f]/;

/**
 * Parse a URL that is about to leave this process, accepting only plain http
 * and https.
 *
 * The checks before `new URL` are there because the parser is forgiving in ways
 * that matter: it silently strips tabs and newlines, reads backslashes as
 * slashes, and accepts `https:example.com`. Messages never repeat the input,
 * which may hold a password.
 *
 * @throws Error saying what is wrong and what a valid value looks like
 */
export function parseHttpUrl(raw: unknown, label = "URL", example = "https://example.com"): URL {
  if (typeof raw !== "string") {
    throw new Error(`${label} must be a string, for example ${example}.`);
  }
  if (CONTROL_OR_SPACE.test(raw)) {
    throw new Error(`${label} must not contain spaces or control characters. Remove them, or percent-encode them.`);
  }
  if (raw.includes("\\")) {
    throw new Error(`${label} must not contain a backslash. Use forward slashes.`);
  }
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`${label} must start with http:// or https://, for example ${example}.`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL. Expected something like ${example}.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain a user name or password. Remove the part before "@".`);
  }
  return url;
}

/**
 * Validate a Rotifer Cloud base address and return it without trailing
 * slashes, ready to have an API path appended.
 *
 * @throws Error saying what is wrong and what a valid value looks like
 */
export function normalizeCloudEndpoint(raw: unknown): string {
  const example = "https://cloud.rotifer.dev";
  const url = parseHttpUrl(raw, "Cloud endpoint", example);
  if (url.search || url.hash) {
    throw new Error(`Cloud endpoint must not include a query string or fragment. Use only the base address, for example ${example}.`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
