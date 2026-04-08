import { execFile } from "node:child_process";

/**
 * Resolve the binary and arguments to open a URL in the default browser.
 * Exported separately for testability.
 */
export function buildOpenCommand(url: string, platform: string): { bin: string; args: string[] } {
  if (platform === "win32") {
    return { bin: "cmd", args: ["/c", "start", "", url] };
  }
  const bin = platform === "darwin" ? "open" : "xdg-open";
  return { bin, args: [url] };
}

/**
 * Open a URL in the user's default browser, cross-platform.
 */
export function openBrowser(url: string): void {
  const { bin, args } = buildOpenCommand(url, process.platform);
  execFile(bin, args);
}
