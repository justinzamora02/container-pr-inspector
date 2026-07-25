import { describe, expect, it } from "vitest";
import { platformString, verifyBaseImage } from "./docker.js";
import type { ImageMetadata } from "./types.js";

const image: ImageMetadata = {
  reference: "example.test/app:abc",
  digest: "example.test/app@sha256:123",
  imageId: "sha256:config",
  revision: "abc",
  platform: { os: "linux", architecture: "amd64" },
  sizeBytes: 100,
  layers: [],
  user: "1000"
};

describe("OCI identity verification", () => {
  it("accepts only an exact full revision match", () => {
    expect(verifyBaseImage(image, "abc")).toEqual({ accepted: true, image });
    expect(verifyBaseImage(image, "abcd")).toMatchObject({
      accepted: false,
      verification: "revision-mismatch"
    });
  });

  it("rejects missing digest and revision metadata distinctly", () => {
    const missingDigest = { ...image };
    const missingRevision = { ...image };
    delete missingDigest.digest;
    delete missingRevision.revision;
    expect(verifyBaseImage(missingDigest, "abc")).toMatchObject({
      accepted: false,
      verification: "missing-digest"
    });
    expect(verifyBaseImage(missingRevision, "abc")).toMatchObject({
      accepted: false,
      verification: "missing-revision"
    });
  });

  it("renders platform variants deterministically", () => {
    expect(
      platformString({ os: "linux", architecture: "arm64", variant: "v8" })
    ).toBe("linux/arm64/v8");
  });
});
