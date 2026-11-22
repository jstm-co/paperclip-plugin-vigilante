import type { StopperKind, WouldDo } from "./classify.js";

export const PLUGIN_KEY = "jstm.vigilante";
export const PAGE_ROUTE = "vigilante";
export const JOB_SCAN = "scan";
export const ACTION_SCAN_NOW = "scan-now";
export const DATA_REPORT = "report";
export const STATE_KEY = "scan";
/** The per-company switch declared in `instanceConfigSchema`. */
export const CONFIG_ENABLED = "enabled";

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
  /** ISO time of the first scan that saw this issue stuck. */
  firstSeenAt: string;
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
  /** Errors of the last scan attempt; empty after a good one. */
  errors: ScanError[];
}

/** What the `report` data endpoint returns: the part of the asked company only. */
export interface Report {
  /** Whether the periodic scan covers this company (per-company switch). */
  enabled: boolean;
  company: CompanySnapshot | null;
  errors: ScanError[];
}
