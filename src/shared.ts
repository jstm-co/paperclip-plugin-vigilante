import type { StopperKind, WouldDo } from "./classify.js";

export const PLUGIN_KEY = "jstm.vigilante";
export const PAGE_ROUTE = "vigilante";
export const JOB_SCAN = "scan";
export const ACTION_SCAN_NOW = "scan-now";
export const DATA_REPORT = "report";
export const STATE_KEY = "scan";

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
  stoppers: StopperView[];
}

export interface ScanError {
  companyId: string | null;
  message: string;
}

export interface Snapshot {
  scannedAt: string;
  durationMs: number;
  companies: CompanySnapshot[];
  errors: ScanError[];
}

/** Report returned by the `report` data endpoint: `null` until the first scan. */
export type Report = Snapshot | null;
