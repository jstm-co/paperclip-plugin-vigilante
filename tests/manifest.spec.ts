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

describe("watch-only guard", () => {
  it("has no write capability besides plugin.state.write", () => {
    const writes = manifest.capabilities.filter(
      (c) => c !== "plugin.state.write" && (/\.write$/.test(c) || /\.(update|create|delete|wakeup|set|add|remove|send)\b/.test(c) || c.startsWith("agent.") || c === "issues.update" || c === "issues.wakeup" || c === "issue.comments.create"),
    );
    expect(writes).toEqual([]);
    for (const banned of ["issues.update", "issues.wakeup", "issue.comments.create"]) expect(manifest.capabilities).not.toContain(banned);
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
