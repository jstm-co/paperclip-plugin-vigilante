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

/** Limits of the only action the plugin has. */
export const NUDGE_SPACING_MS = 24 * 3_600_000;
export const MAX_NUDGES_PER_STOPPER = 3;
export const MAX_NUDGES_PER_SCAN = 5;

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

/** What the plugin did (or could not do) about one stopper. */
export interface NudgeInfo {
  /** Successful wakes so far while the issue stays stuck. */
  count: number;
  /** ISO time of the last successful wake. */
  lastAt: string;
  targetAgentId: string;
  targetAgentName: string;
  lastRunId?: string;
  /** Message of the last failed wake (not counted). */
  lastError?: string;
  /** Why the last scan did not wake: `not_idle:<status>` or `scan_cap`. */
  lastSkip?: string;
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
  /** `nudges[issueId]`: dropped when the issue stops being a stopper. */
  nudges: Record<string, NudgeInfo>;
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
