import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { BrandHeader } from "./brand-header.js";

describe("BrandHeader", () => {
  it.each([1, 24, 80, 104])("stays within %d columns", (width) => {
    const lines = new BrandHeader().render(width);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });

  it("renders a distinctive product lockup with concise feature bullets", () => {
    const rendered = new BrandHeader().render(104).join("\n");
    const plain = stripTerminalSequences(rendered);

    expect(rendered).toContain("\u001b[36m◆\u001b[0m");
    expect(rendered).toContain("\u001b[1;36mWATCHLESS\u001b[0m");
    expect(plain).toBe(
      [
        "◆ WATCHLESS",
        "  • Get YouTube transcripts instantly",
        "  • Summarize videos with AI",
        "  • Export transcripts and summaries",
        "  • Automatic Speech Recognition supported for videos without transcript",
      ].join("\n"),
    );
  });
});
