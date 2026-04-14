import { describe, it, expect } from "vitest";
import { authStatus, listLocalGenes } from "../../src/tools.js";

describe("local filesystem abuse", () => {
  it("handles empty project_root", () => {
    const result = listLocalGenes({ project_root: "" });
    expect(typeof result.total).toBe("number");
  });

  it("handles project_root with spaces", () => {
    const result = listLocalGenes({ project_root: "/tmp/path with spaces" });
    expect(typeof result.total).toBe("number");
  });
});

describe("auth status", () => {
  it("returns valid structure without crashing", () => {
    const result = authStatus();
    expect(typeof result.isLoggedIn).toBe("boolean");
    if (result.isLoggedIn) {
      expect(typeof result.username).toBe("string");
    } else {
      expect(result.username).toBeNull();
    }
  });
});
