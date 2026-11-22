import { describe, expect, it } from "vitest";
import { buildActivityMessage, buildPrompt, MAX_PROMPT_CHARS } from "../src/prompt.js";

const base = { identifier: "ACM-12", title: "Fix the invoice export", holderName: "Backend Dev", text: "Waiting for the Tech Lead: keep the attribution of X and hand the issue back", quietMs: 3 * 3_600_000 };

describe("buildPrompt", () => {
  it("states the notice, the issue, the holder, the text verbatim, the quiet time and what is expected (English)", () => {
    const p = buildPrompt({ ...base, language: "en" });
    expect(p).toContain("Automatic notice from the Vigilante plugin (no AI involved)");
    for (const part of ["ACM-12", "Fix the invoice export", "Backend Dev", base.text, "3 h", "waiting for you", "open that issue", "comment on it"]) expect(p).toContain(part);
  });

  it("is available in Spanish", () => {
    const p = buildPrompt({ ...base, language: "es" });
    expect(p).toContain("Aviso automático del plugin Vigilante (sin IA)");
    for (const part of ["ACM-12", "Fix the invoice export", "Backend Dev", base.text, "3 h", "esperándote", "abre esa tarea", "comenta"]) expect(p).toContain(part);
  });

  it("handles a holder that is not an agent and an unknown quiet time", () => {
    expect(buildPrompt({ ...base, language: "en", holderName: null, quietMs: null })).toContain("held by no agent");
    expect(buildPrompt({ ...base, language: "es", holderName: null, quietMs: null })).toContain("ningún agente");
  });

  it("truncates long text and stays under the limit in both languages", () => {
    const long = "word ".repeat(500);
    for (const language of ["en", "es"] as const) {
      const p = buildPrompt({ ...base, language, title: long, text: long, holderName: long, identifier: long });
      expect(p.length).toBeLessThan(MAX_PROMPT_CHARS);
      expect(p).toContain("...");
    }
  });

  it("is plain text: no markdown markers", () => {
    expect(buildPrompt({ ...base, language: "en" })).not.toMatch(/[*`#\[\]]/);
  });
});

describe("buildActivityMessage", () => {
  it("says who was woken and why, in both languages", () => {
    const input = { identifier: "ACM-12", targetName: "Tech Lead", count: 1, max: 3 };
    expect(buildActivityMessage("en", input)).toContain("woke Tech Lead");
    expect(buildActivityMessage("en", input)).toContain("ACM-12");
    expect(buildActivityMessage("es", input)).toContain("despertó a Tech Lead");
  });
});
