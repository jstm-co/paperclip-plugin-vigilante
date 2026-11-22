import { describe, expect, it } from "vitest";
import { CASE_SENSITIVE_PHRASES, findMentionedAgent, normalizeText, WAITING_PHRASES, type AgentRef } from "../src/mentions.js";

const agent = (id: string, name: string, status = "idle"): AgentRef => ({ id, name, status });
const AGENTS = [agent("a1", "Backend Dev"), agent("a2", "Tech Lead"), agent("a3", "QA Engineer")];
const idOf = (text: string, agents = AGENTS, owner: string | null = "a1") => {
  const r = findMentionedAgent(text, agents, owner);
  return r.kind === "one" ? r.agent.id : r.kind;
};

describe("normalizeText", () => {
  it("lowercases, strips accents and collapses whitespace", () => {
    expect(normalizeText("  Ágata \n  PÉREZ ")).toBe("agata perez");
  });
});

describe("findMentionedAgent", () => {
  it("finds an agent right after a waiting phrase", () => {
    expect(idOf("Waiting for Tech Lead to review")).toBe("a2");
    expect(idOf("Espera al Tech Lead: keep the attribution of X and hand the issue back")).toBe("a2");
    expect(idOf("Waiting for the QA Engineer to reseed")).toBe("a3");
    expect(idOf("Blocked by Tech Lead")).toBe("a2");
    expect(idOf("Esperando a QA Engineer")).toBe("a3");
    expect(idOf("Pendiente del Tech Lead")).toBe("a2");
    expect(idOf("Needs the Tech Lead to approve")).toBe("a2");
    expect(idOf("Falta que el Tech Lead revise")).toBe("a2");
  });

  it("exports the waiting phrases in one constant", () => {
    expect(WAITING_PHRASES).toEqual(expect.arrayContaining(["waiting for", "blocked by", "needs", "espera al", "esperando a", "pendiente del", "depende del", "necesita al"]));
    for (const phrase of WAITING_PHRASES) expect(idOf(`${phrase} Tech Lead`), phrase).toBe(CASE_SENSITIVE_PHRASES.includes(phrase) ? "a2" : "a2");
  });

  it("does not read a name that no waiting phrase introduces", () => {
    expect(idOf("Tech Lead should have reviewed it")).toBe("none");
    expect(idOf("Waiting for the client; Tech Lead knows why")).toBe("none");
    expect(idOf("Blocked until Tech Lead answers")).toBe("none");
  });

  it("ignores case, accents and extra whitespace", () => {
    expect(idOf("waiting for the TECH   LEAD: please")).toBe("a2");
    expect(idOf("ESPERANDO A Técnico Líder", [agent("a1", "x"), agent("a2", "Tecnico Lider")])).toBe("a2");
    expect(idOf("Waiting for Tech\nLead")).toBe("a2");
    expect(idOf("Bloqueada por tecnico lider", [agent("a1", "x"), agent("a2", "Técnico Líder")])).toBe("a2");
  });

  it("matches on word boundaries only", () => {
    expect(idOf("Waiting for the Tech Leader")).toBe("none");
    expect(idOf("waiting for subQA Engineers")).toBe("none");
    expect(idOf("(waiting for QA Engineer) thanks")).toBe("a3");
    expect(idOf("Waiting for QA Engineer.")).toBe("a3");
    expect(idOf("rewaiting for Tech Lead")).toBe("none");
  });

  it("rejects a phrase cancelled by a negation in the same clause", () => {
    expect(idOf("Not waiting on Tech Lead anymore")).toBe("none");
    expect(idOf("No longer waiting for Tech Lead")).toBe("none");
    expect(idOf("Ya no espero al Tech Lead")).toBe("none");
    expect(idOf("Sin esperar... esperando a Tech Lead")).toBe("a2");
    expect(idOf("Tech Lead replied, not blocked by Tech Lead")).toBe("none");
    // A negation in another clause does not count.
    expect(idOf("No issues found. Waiting for Tech Lead")).toBe("a2");
    expect(idOf("Fixed, but waiting for Tech Lead")).toBe("a2");
  });

  it("names of 3 characters or fewer match case-sensitively", () => {
    const agents = [agent("a1", "Backend Dev"), agent("pm", "PM"), agent("qa", "QA"), agent("ana", "Ana"), agent("ceo", "CEO")];
    expect(idOf("Waiting for PM", agents)).toBe("pm");
    expect(idOf("Waiting for pm", agents)).toBe("none");
    expect(idOf("waiting for the qa", agents)).toBe("none");
    expect(idOf("Waiting for Ana", agents)).toBe("ana");
    expect(idOf("Waiting for ana", agents)).toBe("none");
    expect(idOf("Waiting for the CEO", agents)).toBe("ceo");
    // accents are still ignored
    expect(idOf("Waiting for Aná", agents)).toBe("ana");
  });

  it("does not wake on the false positives of the review", () => {
    const agents = [agent("a1", "Backend Dev"), agent("pm", "PM"), agent("data", "Data"), agent("qa", "QA"), agent("ceo", "CEO"), agent("sup", "Support"), agent("ana", "Ana")];
    for (const text of [
      "Waiting for the client to send the logo; call scheduled at 3 PM",
      "Need data from the vendor before continuing",
      "QA already approved; waiting for the client to sign the contract",
      "Not waiting on the CEO anymore: need the user's API key",
      "Board must approve the budget the CEO asked for",
      "Blocked until vendor support answers the ticket",
      "see docs/qa/plan.md; waiting for the customer",
    ]) {
      expect(idOf(text, agents), text).toBe("none");
    }
  });

  it("the bare 'need' and 'needs' require the exact capitalization of the name", () => {
    const agents = [agent("a1", "Backend Dev"), agent("data", "Data")];
    expect(idOf("Need data from the vendor", agents)).toBe("none");
    expect(idOf("Need Data to reseed", agents)).toBe("data");
  });

  it("ignores the assignee itself", () => {
    expect(idOf("Waiting for Backend Dev")).toBe("none");
    expect(idOf("Backend Dev is stuck, waiting for Tech Lead")).toBe("a2");
  });

  it("is ambiguous when two different agents are named, anywhere in the text", () => {
    expect(idOf("Waiting for Tech Lead and QA Engineer")).toBe("ambiguous");
    expect(idOf("QA Engineer approved; waiting for Tech Lead")).toBe("ambiguous");
  });

  it("is ambiguous when two agents share the same name", () => {
    expect(idOf("Waiting for Tech Lead", [...AGENTS, agent("a9", "tech lead")])).toBe("ambiguous");
  });

  it("prefers the longer name when the shorter one lies inside its span", () => {
    const agents = [agent("a1", "Owner"), agent("a2", "Tech"), agent("a3", "Tech Lead")];
    expect(idOf("Waiting for the Tech Lead", agents)).toBe("a3");
    expect(idOf("Waiting for Tech Lead, then Tech applies", agents)).toBe("ambiguous");
  });

  it("does not read the assignee's longer name as a shorter agent", () => {
    const agents = [agent("a1", "Tech Lead Jr"), agent("a2", "Tech Lead")];
    expect(idOf("Waiting for Tech Lead Jr", agents)).toBe("none");
    expect(idOf("Waiting for Tech Lead Jr", agents, null)).toBe("a1");
  });

  it("ignores terminated agents", () => {
    expect(idOf("Waiting for Tech Lead", [agent("a1", "Owner"), agent("a2", "Tech Lead", "terminated")])).toBe("none");
    expect(idOf("Waiting for QA Engineer or Tech Lead", [agent("a2", "Tech Lead", "terminated"), agent("a3", "QA Engineer")])).toBe("a3");
  });

  it("returns none for an empty text or no agents", () => {
    expect(idOf("")).toBe("none");
    expect(idOf("   ")).toBe("none");
    expect(idOf("Waiting for Tech Lead", [])).toBe("none");
  });

  it("ignores agents with an empty name", () => {
    expect(idOf("anything", [agent("a2", "  ")])).toBe("none");
  });
});
