import { describe, expect, it } from "vitest";
import { buildPrompt, MAX_PROMPT_CHARS, MAX_PROMPT_ITEMS, type PromptItem } from "../src/prompt.js";

const item: PromptItem = { identifier: "ACM-12", title: "Fix the invoice export", holderName: "Backend Dev", text: "Waiting for the Tech Lead: keep the attribution of X and hand the issue back", quietMs: 3 * 3_600_000 };
const many = (n: number, over: Partial<PromptItem> = {}): PromptItem[] => Array.from({ length: n }, (_, i) => ({ ...item, identifier: `ACM-${i + 1}`, ...over }));

describe("buildPrompt", () => {
  it("states the notice, the issue, the holder, the text verbatim, the quiet time and what is expected (English)", () => {
    const p = buildPrompt({ language: "en", items: [item] });
    expect(p).toContain("Automatic notice from the Vigilante plugin (no AI involved)");
    for (const part of ["ACM-12", "Fix the invoice export", "Backend Dev", item.text, "3 h", "waiting for you", "open that issue", "comment on it"]) expect(p).toContain(part);
  });

  it("is available in Spanish", () => {
    const p = buildPrompt({ language: "es", items: [item] });
    expect(p).toContain("Aviso automático del plugin Vigilante (sin IA)");
    for (const part of ["ACM-12", "Fix the invoice export", "Backend Dev", item.text, "3 h", "te está esperando", "abre esa tarea", "comenta"]) expect(p).toContain(part);
  });

  it("lists up to 5 issues in one message and summarizes the rest", () => {
    for (const language of ["en", "es"] as const) {
      const p = buildPrompt({ language, items: many(8) });
      for (let i = 1; i <= MAX_PROMPT_ITEMS; i++) expect(p).toContain(`ACM-${i} `);
      expect(p).not.toContain("ACM-6 ");
      expect(p).toContain(language === "en" ? "and 3 more" : "y 3 más");
      expect(p).toContain("8");
    }
    expect(buildPrompt({ language: "en", items: many(5) })).not.toContain("more");
  });

  it("handles a holder that is not an agent and an unknown quiet time", () => {
    expect(buildPrompt({ language: "en", items: [{ ...item, holderName: null, quietMs: null }] })).toContain("held by no agent, quiet for an unknown time");
    expect(buildPrompt({ language: "es", items: [{ ...item, holderName: null, quietMs: null }] })).toContain("ningún agente");
  });

  it("truncates long text and stays under the limit in both languages, whatever the number of issues", () => {
    const long = "word ".repeat(500);
    for (const language of ["en", "es"] as const) {
      for (const n of [1, 3, 5, 9]) {
        const p = buildPrompt({ language, items: many(n, { title: long, text: long, holderName: long, identifier: long }) });
        expect(p.length, `${language} ${n}`).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
        expect(p).toContain("...");
      }
    }
    expect(MAX_PROMPT_CHARS).toBeLessThanOrEqual(1500);
  });

  it("is plain text: no markdown markers", () => {
    expect(buildPrompt({ language: "en", items: many(3) })).not.toMatch(/[*`#\[\]]/);
  });
});
