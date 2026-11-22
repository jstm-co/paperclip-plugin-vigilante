import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.js";

describe("manifest", () => {
  it("is valid for the host's manifest schema", () => {
    const result = pluginManifestV1Schema.safeParse(manifest);
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
  });

  it("declares the per-company switch, off by default", () => {
    const props = (manifest.instanceConfigSchema as { properties: Record<string, { type: string; default: unknown; title: string }> }).properties;
    expect(props.enabled).toMatchObject({ type: "boolean", default: false });
    expect(props.enabled!.title.length).toBeGreaterThan(5);
  });

  it("has a toolbar button and the capability it needs", () => {
    expect(manifest.ui?.slots?.some((s) => s.type === "globalToolbarButton")).toBe(true);
    expect(manifest.capabilities).toContain("ui.action.register");
  });
});

// The exact list: any addition (or removal) must be a deliberate edit of this test.
const CAPABILITIES = [
  "companies.read",
  "issues.read",
  "issue.relations.read",
  "jobs.schedule",
  "plugin.state.read",
  "plugin.state.write",
  "agents.read",
  "agents.invoke",
  "ui.page.register",
  "ui.sidebar.register",
  "ui.action.register",
];

describe("capability guard", () => {
  it("declares exactly these capabilities, and no activity log, issue write, comment or relation write", () => {
    expect([...manifest.capabilities].sort()).toEqual([...CAPABILITIES].sort());
  });

  it("declares act (off), actAfterMinutes and language", () => {
    const props = (manifest.instanceConfigSchema as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(props.act).toMatchObject({ type: "boolean", default: false });
    expect(props.actAfterMinutes).toMatchObject({ type: "integer", default: 30, minimum: 10 });
    expect(props.language).toMatchObject({ type: "string", enum: ["en", "es"], default: "en" });
    for (const key of ["act", "actAfterMinutes", "language"]) expect(String(props[key]!.title).length).toBeGreaterThan(5);
  });

  it("no UI file calls fetch(", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(join(__dirname, "..", "src", "ui"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/\bfetch\s*\(/);
  });
});
