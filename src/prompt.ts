// Pure text for the wake-up: the prompt the woken agent receives and the activity entry.
import { formatDuration, type Locale } from "./i18n.js";

export interface PromptInput {
  language: Locale;
  /** Issue identifier, or its id when it has none. */
  identifier: string;
  title: string;
  /** Name of the agent holding the issue; `null` when it is not held by an agent. */
  holderName: string | null;
  /** The explanation text, verbatim (truncated when very long). */
  text: string;
  quietMs: number | null;
}

export const MAX_PROMPT_CHARS = 900;
const MAX_TEXT = 320;
const MAX_TITLE = 120;
const MAX_NAME = 60;

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

const TEMPLATES: Record<Locale, (v: { id: string; title: string; holder: string; text: string; quiet: string }) => string> = {
  en: (v) =>
    `Automatic notice from the Vigilante plugin (no AI involved). ` +
    `Issue ${v.id} "${v.title}" is held by ${v.holder} and is blocked, waiting for you. ` +
    `Its explanation says: "${v.text}". ` +
    `It has been quiet for ${v.quiet}. ` +
    `What is expected: open that issue and do what it asks, or comment on it if it is not yours to do.`,
  es: (v) =>
    `Aviso automático del plugin Vigilante (sin IA). ` +
    `La tarea ${v.id} "${v.title}" la tiene ${v.holder} y está bloqueada, esperándote a ti. ` +
    `Su explicación dice: "${v.text}". ` +
    `Lleva ${v.quiet} sin movimiento. ` +
    `Lo que se espera: abre esa tarea y haz lo que pide, o comenta en ella si no te corresponde.`,
};

const NOBODY: Record<Locale, string> = { en: "no agent", es: "ningún agente" };

export function buildPrompt(input: PromptInput): string {
  const unknown = input.language === "es" ? "un tiempo desconocido" : "an unknown time";
  const quiet = input.quietMs === null ? unknown : formatDuration(input.language, input.quietMs);
  return TEMPLATES[input.language]({
    id: clip(input.identifier, 40),
    title: clip(input.title, MAX_TITLE),
    holder: input.holderName ? clip(input.holderName, MAX_NAME) : NOBODY[input.language],
    text: clip(input.text, MAX_TEXT),
    quiet,
  });
}

/** Short line for the issue's activity log. */
export function buildActivityMessage(language: Locale, input: { identifier: string; targetName: string; count: number; max: number }): string {
  return language === "es"
    ? `Vigilante despertó a ${clip(input.targetName, MAX_NAME)} porque ${input.identifier} lo espera (aviso ${input.count} de ${input.max})`
    : `Vigilante woke ${clip(input.targetName, MAX_NAME)} because ${input.identifier} is waiting for it (notice ${input.count} of ${input.max})`;
}
