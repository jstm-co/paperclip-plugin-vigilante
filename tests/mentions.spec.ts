import { describe, expect, it } from "vitest";
import { findMentionedAgent, normalizeText, type AgentRef } from "../src/mentions.js";

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
  it("finds an exact name", () => {
    expect(idOf("Waiting for Tech Lead to review")).toBe("a2");
  });

  it("ignores case, accents and extra whitespace", () => {
    expect(idOf("waiting for the TECH   LEAD: please")).toBe("a2");
    expect(idOf("esperando a Técnico Líder", [agent("a1", "x"), agent("a2", "Tecnico Lider")])).toBe("a2");
    expect(idOf("Waiting for Tech\nLead")).toBe("a2");
  });

  it("matches on word boundaries only", () => {
    expect(idOf("Waiting for the Tech Leader")).toBe("none");
    expect(idOf("see subQA Engineers")).toBe("none");
    expect(idOf("(QA Engineer) must check, thanks")).toBe("a3");
    expect(idOf("QA Engineer.")).toBe("a3");
  });

  it("ignores the assignee itself", () => {
    expect(idOf("Backend Dev is stuck")).toBe("none");
    expect(idOf("Backend Dev is stuck without Tech Lead")).toBe("a2");
  });

  it("is ambiguous when two different agents are named", () => {
    expect(idOf("Tech Lead and QA Engineer must agree")).toBe("ambiguous");
  });

  it("is ambiguous when two agents share the same name", () => {
    expect(idOf("Waiting for Tech Lead", [...AGENTS, agent("a9", "tech lead")])).toBe("ambiguous");
  });

  it("prefers the longer name when the shorter one lies inside its span", () => {
    const agents = [agent("a1", "Owner"), agent("a2", "Tech"), agent("a3", "Tech Lead")];
    expect(idOf("Waiting for the Tech Lead", agents)).toBe("a3");
    // "Tech" also stands alone later: both are named, so it is ambiguous.
    expect(idOf("Tech Lead decides, then Tech applies", agents)).toBe("ambiguous");
  });

  it("does not read the assignee's longer name as a shorter agent", () => {
    const agents = [agent("a1", "Tech Lead Jr"), agent("a2", "Tech Lead")];
    expect(idOf("Waiting for Tech Lead Jr", agents)).toBe("none");
    expect(idOf("Waiting for Tech Lead Jr", agents, null)).toBe("a1");
  });

  it("ignores terminated agents", () => {
    expect(idOf("Waiting for Tech Lead", [agent("a1", "Owner"), agent("a2", "Tech Lead", "terminated")])).toBe("none");
    expect(idOf("Tech Lead or QA Engineer", [agent("a2", "Tech Lead", "terminated"), agent("a3", "QA Engineer")])).toBe("a3");
  });

  it("returns none for an empty text or no agents", () => {
    expect(idOf("")).toBe("none");
    expect(idOf("   ")).toBe("none");
    expect(idOf("Tech Lead", [])).toBe("none");
  });

  it("ignores agents with an empty name", () => {
    expect(idOf("anything", [agent("a2", "  ")])).toBe("none");
  });
});
