import { describe, expect, it } from "vitest";
import { CATALOGS, formatDuration, pickLocale, translate } from "../src/i18n.js";

describe("i18n", () => {
  it("both catalogs have the same keys and no empty text", () => {
    expect(Object.keys(CATALOGS.es).sort()).toEqual(Object.keys(CATALOGS.en).sort());
    for (const locale of ["es", "en"] as const) {
      for (const text of Object.values(CATALOGS[locale])) expect(text.length).toBeGreaterThan(0);
    }
  });

  it("keeps the same {placeholders} in both languages", () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(CATALOGS.en) as Array<keyof typeof CATALOGS.en>) {
      expect(names(CATALOGS.es[key])).toEqual(names(CATALOGS.en[key]));
    }
  });

  it("is Spanish unless the host locale is English", () => {
    expect(pickLocale([])).toBe("es");
    expect(pickLocale(["es-CL"])).toBe("es");
    expect(pickLocale(["fr-FR"])).toBe("es");
    expect(pickLocale(["en"])).toBe("en");
    expect(pickLocale(["en-US", "es"])).toBe("en");
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(translate("en", "issues.many", { n: 3 })).toBe("3 issues");
    expect(translate("es", "issues.many")).toBe("{n} tareas");
  });

  it("formats durations", () => {
    expect(formatDuration("en", 10_000)).toBe("just now");
    expect(formatDuration("en", 5 * 60_000)).toBe("5 min");
    expect(formatDuration("en", 3 * 3_600_000)).toBe("3 h");
    expect(formatDuration("es", 3 * 24 * 3_600_000)).toBe("3 d");
  });
});
