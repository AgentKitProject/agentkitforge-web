import { describe, it, expect } from "vitest";
import { isValidSectionId } from "@/app/forge/section-ids";

describe("isValidSectionId", () => {
  it("accepts all NAV section ids", () => {
    const validIds = [
      "my-kits",
      "build",
      "use",
      "run",
      "auto",
      "import",
      "package-export",
      "install-targets",
      "market-submit",
      "settings",
      "about",
    ];
    for (const id of validIds) {
      expect(isValidSectionId(id), `expected "${id}" to be valid`).toBe(true);
    }
  });

  it("accepts 'account' even though it is not in NAV", () => {
    expect(isValidSectionId("account")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isValidSectionId("auto-section")).toBe(false);
    expect(isValidSectionId("")).toBe(false);
    expect(isValidSectionId("dashboard")).toBe(false);
    expect(isValidSectionId("AUTO")).toBe(false);
  });
});
