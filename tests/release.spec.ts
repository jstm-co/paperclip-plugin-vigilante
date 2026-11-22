import { describe, expect, it } from "vitest";
import { isNotFound } from "../scripts/release.mjs";
import { nextReleaseVersion } from "../scripts/version.mjs";

describe("release script", () => {
  it("treats npm E404 as 'never published'", () => {
    expect(isNotFound({ stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/x" })).toBe(true);
    expect(isNotFound({ stderr: "npm error code ENOTFOUND network" })).toBe(false);
    expect(isNotFound(new Error("boom"))).toBe(false);
  });

  it("the first release of a day is sequence 0", () => {
    expect(nextReleaseVersion([], new Date("2026-11-03T10:00:00Z"))).toBe("2026.1103.0");
  });
});
