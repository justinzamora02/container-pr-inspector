export interface ScannerAsset {
  url: string;
  sha256: string;
  executable: string;
}

export interface ScannerRelease {
  version: string;
  assets: Record<"x64" | "arm64", ScannerAsset>;
}

// SHA-256 values are copied from the immutable upstream release checksum files.
export const SCANNER_RELEASES: Record<"trivy" | "syft", ScannerRelease> = {
  trivy: {
    version: "0.72.0",
    assets: {
      x64: {
        url: "https://github.com/aquasecurity/trivy/releases/download/v0.72.0/trivy_0.72.0_Linux-64bit.tar.gz",
        sha256: "bbb64b9695866ce4a7a8f5c9592002c5961cab378577fa3f8a040df362b9b2ea",
        executable: "trivy"
      },
      arm64: {
        url: "https://github.com/aquasecurity/trivy/releases/download/v0.72.0/trivy_0.72.0_Linux-ARM64.tar.gz",
        sha256: "2ca2c023109c2db6b2b77366b6717291452d4531167377d95c79547f0c8e3467",
        executable: "trivy"
      }
    }
  },
  syft: {
    version: "1.44.0",
    assets: {
      x64: {
        url: "https://github.com/anchore/syft/releases/download/v1.44.0/syft_1.44.0_linux_amd64.tar.gz",
        sha256: "0e91737aee2b5baf1d255b959630194a302335d848ff97bb07921eb6205b5f5a",
        executable: "syft"
      },
      arm64: {
        url: "https://github.com/anchore/syft/releases/download/v1.44.0/syft_1.44.0_linux_arm64.tar.gz",
        sha256: "6f6cdcdc695721d91ce756e3b5bc3e3416599c464101f5e32e9c3f33054ee6d9",
        executable: "syft"
      }
    }
  }
};
