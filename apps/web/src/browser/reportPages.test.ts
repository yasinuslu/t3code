import { describe, expect, it } from "vite-plus/test";

import { resolveBrowserViewportLayout } from "./browserViewportLayout";
import { isReportPage, REPORT_DESIGN_VIEWPORT } from "./reportPages";

describe("isReportPage", () => {
  it("recognises the nep-report meta tag in any attribute order", () => {
    expect(isReportPage('<head><meta name="nep-report" content="1440x900"></head>')).toBe(true);
    expect(isReportPage("<meta content='1' name='nep-report'/>")).toBe(true);
  });

  it("ignores ordinary pages and look-alike names", () => {
    expect(isReportPage('<meta name="viewport" content="width=device-width">')).toBe(false);
    expect(isReportPage('<meta name="nep-reporting">')).toBe(false);
    expect(isReportPage("<p>name=nep-report</p>")).toBe(false);
  });
});

describe("report page layout", () => {
  it("scales the design viewport up to fill a large panel at its proportions", () => {
    const layout = resolveBrowserViewportLayout(
      { width: 1800, height: 1500 },
      REPORT_DESIGN_VIEWPORT,
      1,
      true,
    );
    expect(layout.viewportScale).toBe(1.25);
    expect(layout.viewportWidth).toBe(1800);
    expect(layout.viewportHeight).toBe(1125);
  });

  it("still never upscales an ordinary fixed viewport", () => {
    const layout = resolveBrowserViewportLayout(
      { width: 1800, height: 1500 },
      REPORT_DESIGN_VIEWPORT,
    );
    expect(layout.viewportScale).toBe(1);
  });
});
