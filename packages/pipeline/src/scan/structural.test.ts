import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { StructuralScanner } from "./structural.js";

const scanner = new StructuralScanner();
const enc = (s: string) => new TextEncoder().encode(s);
const pdfBytes = (body: string) => enc(`%PDF-1.7\n${body}\n%%EOF`);
const scanPdf = (body: string) => scanner.scan(pdfBytes(body), "application/pdf");

describe("StructuralScanner", () => {
  it("clean minimal PDF passes", async () => {
    const r = await scanPdf("1 0 obj << /Type /Catalog >> endobj");
    expect(r).toEqual({ status: "clean", engine: "structural-v1" });
  });

  it("magic-byte mismatch: PNG bytes declared as PDF", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = await scanner.scan(png, "application/pdf");
    expect(r.status).toBe("infected");
    expect(r.detail).toContain("magic bytes");
  });

  it("valid magic for every allowed non-PDF type", async () => {
    const cases: [string, number[]][] = [
      ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
      ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
      ["image/tiff", [0x49, 0x49, 0x2a, 0x00]],
      ["image/tiff", [0x4d, 0x4d, 0x00, 0x2a]],
      [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [0x50, 0x4b, 0x03, 0x04],
      ],
      ["application/vnd.ms-excel", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
    ];
    for (const [mime, magic] of cases) {
      const r = await scanner.scan(new Uint8Array([...magic, 0, 0, 0, 0]), mime);
      expect(r.status, mime).toBe("clean");
    }
  });

  it("encrypted PDFs are rejected - content must be reviewable", async () => {
    const r = await scanPdf("trailer << /Encrypt 5 0 R >>");
    expect(r.status).toBe("infected");
    expect(r.detail).toContain("encrypted");
  });

  it("JavaScript actions are rejected (/JS and /JavaScript)", async () => {
    for (const body of ["<< /S /JavaScript /JS (app.alert(1)) >>", "<< /JS (evil()) >>"]) {
      const r = await scanPdf(body);
      expect(r.status, body).toBe("infected");
    }
  });

  it("launch actions and embedded files are rejected", async () => {
    for (const body of ["<< /S /Launch /F (cmd.exe) >>", "<< /Type /EmbeddedFile >>"]) {
      const r = await scanPdf(body);
      expect(r.status, body).toBe("infected");
    }
  });

  it("token boundary: /JSmith is a name, not a JavaScript action", async () => {
    const r = await scanPdf("<< /JSmith (John) >>");
    expect(r.status).toBe("clean");
  });

  // ── Evasion regressions (adversarial review 2026-07-29). Both of these
  // shipped-clean against the first version of the scanner. ──

  it("EVASION: JavaScript hidden in a compressed object stream is caught", async () => {
    // A /Type /ObjStm whose inflated payload carries the JS action dict -
    // exactly what `qpdf --object-streams=generate` produces. The raw file
    // bytes contain no /JS or /JavaScript at all.
    const payload = Buffer.from(
      "1 0 2 52 << /Type /Catalog /OpenAction 2 0 R >> << /S /JavaScript /JS (app.alert(1)) >>",
    );
    const compressed = deflateSync(payload);
    const head = Buffer.from(
      "%PDF-1.5\n3 0 obj << /Type /ObjStm /N 2 /First 12 /Filter /FlateDecode /Length " +
        compressed.length +
        " >>\nstream\n",
    );
    const bytes = new Uint8Array(
      Buffer.concat([head, compressed, Buffer.from("\nendstream endobj\n%%EOF")]),
    );
    expect(new TextDecoder().decode(bytes)).not.toContain("/JavaScript");

    const r = await scanner.scan(bytes, "application/pdf");
    expect(r.status).toBe("infected");
    expect(r.detail).toContain("JavaScript");
  });

  it("EVASION: hex-escaped name objects are normalized before matching", async () => {
    // /J#61vaScript ≡ /JavaScript and /J#53 ≡ /JS to every real reader.
    for (const body of [
      "<< /S /J#61vaScript /J#53 (app.alert(1)) >>",
      "<< /S /Launc#68 /F (cmd.exe) >>",
      "trailer << /Encryp#74 5 0 R >>",
      "<< /Type /EmbeddedFil#65 >>",
    ]) {
      const r = await scanPdf(body);
      expect(r.status, body).toBe("infected");
    }
  });

  it("page content streams are NOT scanned - printing the word is not an action", async () => {
    // A tax form that merely renders the text "JavaScript" must pass.
    const content = deflateSync(Buffer.from("BT (JavaScript /Launch) Tj ET"));
    const bytes = new Uint8Array(
      Buffer.concat([
        Buffer.from(
          "%PDF-1.7\n4 0 obj << /Length " + content.length + " /Filter /FlateDecode >>\nstream\n",
        ),
        content,
        Buffer.from("\nendstream endobj\n%%EOF"),
      ]),
    );
    const r = await scanner.scan(bytes, "application/pdf");
    expect(r.status).toBe("clean");
  });

  it("malformed object stream does not crash the scanner", async () => {
    const bytes = new Uint8Array(
      Buffer.concat([
        Buffer.from("%PDF-1.5\n1 0 obj << /Type /ObjStm /Filter /FlateDecode >>\nstream\n"),
        Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]), // not valid Flate
        Buffer.from("\nendstream\n%%EOF"),
      ]),
    );
    const r = await scanner.scan(bytes, "application/pdf");
    expect(r.status).toBe("clean"); // skipped, not fatal
  });

  it("empty file and unknown declared type are rejected", async () => {
    expect((await scanner.scan(new Uint8Array(), "application/pdf")).status).toBe("infected");
    expect((await scanner.scan(enc("<html>"), "text/html")).status).toBe("infected");
  });
});
