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

const ALLOWED_WRITES = ["plugin.state.write", "agents.invoke", "activity.log.write"];

describe("capability guard", () => {
  it("has no write capability besides state, agents.invoke and activity.log.write", () => {
    const writes = manifest.capabilities.filter(
      (c) => !ALLOWED_WRITES.includes(c) && (/\.write$/.test(c) || /\.(update|create|delete|wakeup|set|add|remove|send|invoke|pause|resume)\b/.test(c) || c.startsWith("agent.") || c.startsWith("agents.") && c !== "agents.read"),
    );
    expect(writes).toEqual([]);
    for (const wanted of ALLOWED_WRITES) expect(manifest.capabilities).toContain(wanted);
    expect(manifest.capabilities).toContain("agents.read");
    for (const banned of ["issues.update", "issues.wakeup", "issue.comments.create", "issue.relations.write"]) expect(manifest.capabilities).not.toContain(banned);
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
