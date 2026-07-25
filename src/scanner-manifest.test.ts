import { describe, expect, it } from "vitest";
import { SCANNER_RELEASES } from "./scanner-manifest.js";

describe("scanner release manifest", () => {
  it("pins immutable HTTPS assets and SHA-256 values for both architectures", () => {
    for (const release of Object.values(SCANNER_RELEASES)) {
      for (const asset of Object.values(release.assets)) {
        expect(asset.url).toMatch(/^https:\/\/github\.com\//);
        expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });
});
