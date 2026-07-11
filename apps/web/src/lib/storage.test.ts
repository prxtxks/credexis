import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  SIGNED_URL_TTL_SECONDS,
  pageImageObjectKey,
  uploadObjectKey,
} from "./storage";

const TENANT = "00000000-0000-4000-a000-00000000000a";
const DEAL = "00000000-0000-4000-a000-0000000000da";
const LDOC = "00000000-0000-4000-a000-0000000000dc";
const HASH = "a".repeat(64);

describe("uploadObjectKey", () => {
  it("builds tenant-first content-addressed keys (RLS depends on segment 1)", () => {
    const key = uploadObjectKey(TENANT, DEAL, HASH, "application/pdf");
    expect(key).toBe(`${TENANT}/deals/${DEAL}/uploads/${HASH}.pdf`);
    expect(key.split("/")[0]).toBe(TENANT);
  });

  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/tiff", "tif"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["application/vnd.ms-excel", "xls"],
  ])("maps %s → .%s", (mime, ext) => {
    expect(uploadObjectKey(TENANT, DEAL, HASH, mime)).toMatch(new RegExp(`\\.${ext}$`));
  });

  it("rejects disallowed mime types (matches the bucket allowlist)", () => {
    expect(() => uploadObjectKey(TENANT, DEAL, HASH, "application/zip")).toThrow(/not allowed/);
    expect(() => uploadObjectKey(TENANT, DEAL, HASH, "text/html")).toThrow(/not allowed/);
  });

  it("rejects malformed ids and hashes (path injection is impossible)", () => {
    expect(() => uploadObjectKey("not-a-uuid", DEAL, HASH, "application/pdf")).toThrow(/uuid/);
    expect(() => uploadObjectKey(`${TENANT}/evil`, DEAL, HASH, "application/pdf")).toThrow(/uuid/);
    expect(() => uploadObjectKey(TENANT, DEAL, "beef", "application/pdf")).toThrow(/hex-64/);
    expect(() => uploadObjectKey(TENANT, DEAL, HASH.toUpperCase(), "application/pdf")).toThrow(
      /hex-64/,
    );
  });
});

describe("pageImageObjectKey", () => {
  it("builds tenant-first page keys", () => {
    expect(pageImageObjectKey(TENANT, DEAL, LDOC, 3)).toBe(
      `${TENANT}/deals/${DEAL}/pages/${LDOC}/3.png`,
    );
  });

  it("rejects non-positive and fractional page numbers", () => {
    expect(() => pageImageObjectKey(TENANT, DEAL, LDOC, 0)).toThrow(/positive integer/);
    expect(() => pageImageObjectKey(TENANT, DEAL, LDOC, 1.5)).toThrow(/positive integer/);
  });
});

describe("constants mirror the bucket config (migration 0003)", () => {
  it("50 MiB size limit, short signed-URL TTL", () => {
    expect(MAX_UPLOAD_BYTES).toBe(52_428_800);
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });
});
