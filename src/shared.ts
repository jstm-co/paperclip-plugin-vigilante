import { DEFAULT_ACT_AFTER_MINUTES, MIN_ACT_AFTER_MINUTES, type StopperKind, type WouldDo } from "./classify.js";
import type { Locale } from "./i18n.js";

export const PLUGIN_KEY = "jstm.vigilante";
export const PAGE_ROUTE = "vigilante";
export const JOB_SCAN = "scan";
export const ACTION_SCAN_NOW = "scan-now";
export const DATA_REPORT = "report";
export const STATE_KEY = "scan";
/** The per-company switch declared in `instanceConfigSchema`. */
export const CONFIG_ENABLED = "enabled";
/** Per-company switch for acting (waking the agent another agent waits for). */
export const CONFIG_ACT = "act";
export const CONFIG_ACT_AFTER = "actAfterMinutes";
export const CONFIG_LANGUAGE = "language";

/**
 * Limits of the only action the plugin has. All of them are enforced from the
 * company's stored record, and an attempt counts whether the invoke worked,
 * threw or timed out.
 */
/** Minimum time between two wakes counted for the same stopper. */
export const NUDGE_SPACING_MS = 24 * 3_600_000;
/** Wakes per stopper for the whole life of its record. */
export const MAX_NUDGES_PER_STOPPER = 3;
/** `agents.invoke` calls per company and scan. */
export const MAX_NUDGES_PER_SCAN = 5;
/** Minimum time between two wakes of the same target agent. */
export const NUDGE_AGENT_SPACING_MS = 60 * 60_000;
/** Wakes of the same target agent in any rolling 24 hours. */
export const MAX_NUDGES_PER_AGENT_DAY = 6;
/** Wakes in the whole company in any rolling 24 hours. */
export const MAX_NUDGES_PER_COMPANY_DAY = 20;
/** The rolling window of the two caps above. */
export const NUDGE_WINDOW_MS = 24 * 3_600_000;
/** A wake record is dropped this long after its last wake, or as soon as the issue leaves the open lists. */
export const NUDGE_RECORD_TTL_MS = 14 * 24 * 3_600_000;

/** The per-company configuration, already validated. */
export interface CompanyConfig {
  enabled: boolean;
  act: boolean;
  actAfterMinutes: number;
  /** Language of the text sent to the woken agent. */
  language: Locale;
}

export const DEFAULT_CONFIG: CompanyConfig = { enabled: false, act: false, actAfterMinutes: DEFAULT_ACT_AFTER_MINUTES, language: "en" };

/** Reads a saved company config; anything invalid falls back to its default. */
export function parseConfig(config: Record<string, unknown> | null | undefined): CompanyConfig {
  const after = config?.[CONFIG_ACT_AFTER];
  const language = config?.[CONFIG_LANGUAGE];
  return {
    enabled: config?.[CONFIG_ENABLED] === true,
    act: config?.[CONFIG_ACT] === true,
    actAfterMinutes: typeof after === "number" && Number.isInteger(after) && after >= MIN_ACT_AFTER_MINUTES ? after : DEFAULT_ACT_AFTER_MINUTES,
    language: language === "es" || language === "en" ? language : "en",
  };
}

/** How the last counted wake ended: not known yet, accepted by the host, or failed. */
export type NudgeState = "attempted" | "woken" | "failed";

/** What the plugin did (or could not do) about one stopper. */
export interface NudgeInfo {
  /** Wake attempts so far (counted before the invoke, whatever its outcome). */
  count: number;
  /** ISO time of the last attempt. */
  lastAt: string;
  targetAgentId: string;
  targetAgentName: string;
  /** Outcome of the last attempt; missing in records written by older versions. */
  state?: NudgeState;
  lastRunId?: string;
  /** Message of the last failed attempt (it still counts). */
  lastError?: string;
  /** Why the last scan did not wake: `not_idle:<status>`, `scan_cap`, `agent_gap`, `agent_day` or `company_day`. */
  lastSkip?: string;
}

/** One counted wake of a target agent, kept for the rolling per-agent and per-company caps. */
export interface WakeLogEntry {
  at: string;
  agentId: string;
}

/** A stopper as stored in the snapshot and shown by the UI. */
export interface StopperView {
  issueId: string;
  identifier: string | null;
  title: string | null;
  status: string | null;
  kind: StopperKind;
  wouldDo: WouldDo;
  stops: number;
  quietMs: number | null;
  reason: string | null;
  /** Moved less than the quiet threshold ago: shown apart, nothing would be done yet. */
  recent: boolean;
  /** ISO time of the first scan that saw this issue stuck. */
  firstSeenAt: string;
  /** The agent a `waiting_agent` stopper waits for. */
  targetAgentId: string | null;
  targetAgentName: string | null;
  nudge: NudgeInfo | null;
}

export interface CompanySnapshot {
  id: string;
  name: string;
  issuePrefix: string | null;
  /** ISO time of the last scan of this company that finished. */
  scannedAt: string;
  durationMs: number;
  stoppers: StopperView[];
}

export interface ScanError {
  companyId: string | null;
  /** Shown in the UI so the message says which company failed. */
  companyName?: string | null;
  message: string;
}

/**
 * What is stored for ONE company (plugin state, company scope). Each company has
 * its own record, so a scan of one company can never touch another one's data.
 */
export interface CompanyState {
  /** `null` until the first scan of the company finishes. */
  company: CompanySnapshot | null;
  /** `firstSeen[issueId]`: ISO time of the first scan that saw the issue stuck. */
  firstSeen: Record<string, string>;
  /** `nudges[issueId]`: kept until the issue leaves the open lists or 14 days after its last wake. */
  nudges: Record<string, NudgeInfo>;
  /** Counted wakes of the last 24 hours (pruned on every scan). */
  wakeLog: WakeLogEntry[];
  /** Errors of the last scan attempt; empty after a good one. */
  errors: ScanError[];
}

/** What the `report` data endpoint returns: the part of the asked company only. */
export interface Report {
  /** Whether the periodic scan covers this company (per-company switch). */
  enabled: boolean;
  /** Whether acting is on for this company. */
  act: boolean;
  company: CompanySnapshot | null;
  errors: ScanError[];
}
