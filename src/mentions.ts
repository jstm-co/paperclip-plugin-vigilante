// Pure, deterministic detection of which agent an explanation text names.
// No AI: plain text matching on normalized strings.

export interface AgentRef {
  id: string;
  name: string;
  status: string;
}

export type MentionResult =
  | { kind: "one"; agent: AgentRef }
  | { kind: "none" }
  | { kind: "ambiguous" };

/** Lower case, accent-insensitive (NFD, marks removed), whitespace collapsed and trimmed. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char);

interface Hit {
  agent: AgentRef;
  start: number;
  end: number;
}

/** Every occurrence of `needle` in `haystack` that sits on word boundaries. */
function occurrences(haystack: string, needle: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const end = at + needle.length;
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[end])) found.push([at, end]);
    from = at + 1;
  }
  return found;
}

/**
 * Finds the single agent, other than `ownerAgentId` (the issue's assignee), that
 * `text` names. Terminated agents are ignored. When several names match, a match
 * lying strictly inside a longer different match's span is dropped (the longest
 * name wins); what is left must be exactly one agent, otherwise it is ambiguous.
 * The owner takes part in the containment step (so "Tech Lead Jr" is not read as
 * "Tech Lead") and is removed afterwards.
 */
export function findMentionedAgent(text: string, agents: readonly AgentRef[], ownerAgentId: string | null): MentionResult {
  const haystack = normalizeText(text);
  if (haystack.length === 0) return { kind: "none" };

  const hits: Hit[] = [];
  for (const agent of agents) {
    if (agent.status === "terminated") continue;
    const needle = normalizeText(agent.name);
    if (needle.length === 0) continue;
    for (const [start, end] of occurrences(haystack, needle)) hits.push({ agent, start, end });
  }

  const outer = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other.agent.id !== hit.agent.id &&
          other.start <= hit.start &&
          other.end >= hit.end &&
          other.end - other.start > hit.end - hit.start,
      ),
  );

  const ids = new Set(outer.filter((hit) => hit.agent.id !== ownerAgentId).map((hit) => hit.agent.id));
  if (ids.size === 0) return { kind: "none" };
  if (ids.size > 1) return { kind: "ambiguous" };
  const [id] = ids;
  return { kind: "one", agent: agents.find((agent) => agent.id === id)! };
}
