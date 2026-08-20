import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { badge, KeyHints, SectionHeader, StatusLine } from "./design-system.js";

describe("app design system", () => {
  it.each([1, 12, 40])("keeps reusable components within %d columns", (width) => {
    const components = [
      new SectionHeader("A long section heading", "Secondary metadata", 1),
      new KeyHints(
        [
          ["Enter", "select the active row"],
          ["Esc", "close"],
        ],
        { paddingX: 1 },
      ),
      new StatusLine("Processing completed successfully.", "success"),
    ];

    for (const component of components) {
      expect(component.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("applies semantic status and badge tones without changing copied text", () => {
    const status = new StatusLine("Ready", "muted");
    status.setStatus("Complete", "success");
    const renderedStatus = status.render(40).join("\n");
    const renderedBadge = badge("SUMMARY", "success");

    expect(renderedStatus).toContain("\u001b[32mComplete\u001b[0m");
    expect(renderedBadge).toContain("\u001b[32m[SUMMARY]\u001b[0m");
    expect(stripTerminalSequences(renderedStatus).trimEnd()).toBe("Complete");
    expect(stripTerminalSequences(renderedBadge)).toBe("[SUMMARY]");
  });
});
