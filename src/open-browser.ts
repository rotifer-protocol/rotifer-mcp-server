import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { parseHttpUrl } from "./validate-url.js";

/**
 * Resolve the binary and arguments to open a URL in the default browser.
 * Exported separately for testability.
 *
 * Windows must not go through `cmd /c start`: cmd.exe re-parses the command
 * line, so an `&` in the URL ends the command. That truncates every OAuth URL
 * and lets the rest of the text run as a command. rundll32 receives the URL as
 * data and hands it to the shell's URL handler. It is named by absolute path
 * because Windows process creation searches the current directory first for a
 * bare name, and this server often runs inside a project it does not trust.
 */
export function buildOpenCommand(
  url: string,
  platform: string,
  env: NodeJS.ProcessEnv = process.env,
): { bin: string; args: string[] } {
  if (platform === "win32") {
    const bin = win32.join(env.SystemRoot || "C:\\Windows", "System32", "rundll32.exe");
    return { bin, args: ["url.dll,FileProtocolHandler", url] };
  }
  const bin = platform === "darwin" ? "open" : "xdg-open";
  return { bin, args: [url] };
}

/**
 * Open an http or https URL in the user's default browser, cross-platform.
 * Every platform's opener also accepts local files and other protocol handlers,
 * so the check is made here rather than left to callers.
 *
 * @throws Error if the URL is not a plain http or https URL
 */
export function openBrowser(url: string): void {
  const { bin, args } = buildOpenCommand(parseHttpUrl(url).href, process.platform);
  execFile(bin, args);
}
