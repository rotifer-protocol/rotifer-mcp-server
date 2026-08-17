import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("../../src/auth.js", () => ({
  loadCredentials: vi.fn().mockReturnValue(null),
  saveCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  generateCodeVerifier: vi.fn(),
  generateCodeChallenge: vi.fn(),
  startOAuthCallbackServer: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function binaryResponse(bytes: Buffer, status = 200) {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: () => Promise.resolve(copy),
    text: () => Promise.resolve(""),
  };
}

const { installGene } = await import("../../src/cloud.js");
const { existsSync, writeFileSync } = await import("node:fs");

const GENE_ID = "11111111-1111-1111-1111-111111111111";
const wasmBytes = Buffer.from("\0asm-fake-module-bytes-for-install-test");
const wasmHash = createHash("sha256").update(wasmBytes).digest("hex");

function geneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GENE_ID,
    name: "demo-gene",
    domain: "test.demo",
    version: "0.1.0",
    fidelity: "Native",
    description: "demo",
    phenotype: { name: "demo-gene", domain: "test.demo" },
    wasm_size: wasmBytes.length,
    wasm_hash: wasmHash,
    wasm_path: "u1/demo-gene/0.1.0/gene.ir.wasm",
    content_hash: null,
    downloads: 0,
    reputation_score: null,
    previous_version_id: null,
    changelog: null,
    published: true,
    owner_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    profiles: { username: "tester" },
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(writeFileSync).mockReset();
});

function wasmWrites() {
  return vi.mocked(writeFileSync).mock.calls.filter(([path]) =>
    String(path).endsWith("gene.ir.wasm"),
  );
}

function manifestWrites() {
  return vi.mocked(writeFileSync).mock.calls.filter(([path]) =>
    String(path).endsWith(".cloud-manifest.json"),
  );
}

describe("installGene WASM download", () => {
  it("downloads the WASM artifact from the public storage URL and writes gene.ir.wasm", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([geneRow()]))
      .mockResolvedValueOnce(binaryResponse(wasmBytes))
      .mockResolvedValueOnce(jsonResponse({}));

    const result = await installGene(GENE_ID, "/project");

    const wasmCall = mockFetch.mock.calls[1];
    expect(String(wasmCall[0])).toBe(
      "https://cloud.rotifer.dev/storage/v1/object/public/gene-wasm/u1/demo-gene/0.1.0/gene.ir.wasm",
    );

    expect(wasmWrites()).toHaveLength(1);
    const written = wasmWrites()[0][1] as Buffer;
    expect(Buffer.compare(written, wasmBytes)).toBe(0);
    expect(result.wasmDownloaded).toBe(true);
  });

  it("rejects on sha256 hash mismatch and writes neither WASM nor manifest", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([geneRow({ wasm_hash: "0".repeat(64) })]))
      .mockResolvedValueOnce(binaryResponse(wasmBytes));

    await expect(installGene(GENE_ID, "/project")).rejects.toThrow(/hash mismatch/i);
    expect(wasmWrites()).toHaveLength(0);
    expect(manifestWrites()).toHaveLength(0);
  });

  it("rejects on size mismatch", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([geneRow({ wasm_size: wasmBytes.length + 7 })]))
      .mockResolvedValueOnce(binaryResponse(wasmBytes));

    await expect(installGene(GENE_ID, "/project")).rejects.toThrow(/size mismatch/i);
    expect(wasmWrites()).toHaveLength(0);
  });

  it("rejects when the WASM download itself fails", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([geneRow()]))
      .mockResolvedValueOnce(binaryResponse(wasmBytes, 404));

    await expect(installGene(GENE_ID, "/project")).rejects.toThrow(/download/i);
    expect(wasmWrites()).toHaveLength(0);
  });

  it("stays metadata-only for genes without a WASM artifact", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([geneRow({ wasm_path: null, wasm_hash: null, wasm_size: 0 })]))
      .mockResolvedValueOnce(jsonResponse({}));

    const result = await installGene(GENE_ID, "/project");

    expect(result.wasmDownloaded).toBe(false);
    expect(wasmWrites()).toHaveLength(0);
    expect(manifestWrites()).toHaveLength(1);
  });
});

/**
 * The install counter fires whether or not you are signed in — it carries a
 * Gene id and no identity, so signing in is not what turns it on. That was
 * never disclosed, which made "signed out, nothing is reported" false for
 * anyone who installed something. These tests hold both halves of the fix:
 * it still counts installs, and the documented opt-out actually stops it.
 */
describe("installGene download counter", () => {
  const originalFlag = process.env.ROTIFER_TELEMETRY;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ROTIFER_TELEMETRY;
    else process.env.ROTIFER_TELEMETRY = originalFlag;
  });

  function counterCalls() {
    return mockFetch.mock.calls.filter(([url]) => String(url).includes("/rpc/track_download"));
  }

  async function installWithoutWasm() {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([geneRow({ wasm_path: null, wasm_hash: null, wasm_size: 0 })]))
      .mockResolvedValueOnce(jsonResponse({}));
    return installGene(GENE_ID, "/project");
  }

  it("counts the install when signed out, carrying the Gene id and no identity", async () => {
    delete process.env.ROTIFER_TELEMETRY;

    await installWithoutWasm();

    expect(counterCalls()).toHaveLength(1);
    const [, opts] = counterCalls()[0];
    expect(JSON.parse(String(opts.body))).toEqual({ p_gene_id: GENE_ID });
    expect(opts.headers).not.toHaveProperty("Authorization");
  });

  it.each(["0", "false", "off", "OFF", " 0 "])(
    "sends nothing when ROTIFER_TELEMETRY=%s, and still installs",
    async (flag) => {
      process.env.ROTIFER_TELEMETRY = flag;

      const result = await installWithoutWasm();

      expect(counterCalls()).toHaveLength(0);
      expect(result.name).toBe("demo-gene");
      expect(manifestWrites()).toHaveLength(1);
    },
  );

  it("still counts when ROTIFER_TELEMETRY holds something that is not an opt-out", async () => {
    process.env.ROTIFER_TELEMETRY = "1";

    await installWithoutWasm();

    expect(counterCalls()).toHaveLength(1);
  });
});
