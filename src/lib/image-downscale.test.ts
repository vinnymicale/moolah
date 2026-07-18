import { describe, it, expect } from "vitest";
import { shouldDownscale, scaledDimensions, MAX_IMAGE_DIMENSION } from "./image-downscale";

describe("shouldDownscale", () => {
  it("is true for raster images and false for pdf", () => {
    expect(shouldDownscale("image/jpeg")).toBe(true);
    expect(shouldDownscale("image/heic")).toBe(true);
    expect(shouldDownscale("application/pdf")).toBe(false);
  });
});

describe("scaledDimensions", () => {
  it("leaves small images alone", () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("caps the long edge and keeps aspect ratio", () => {
    expect(scaledDimensions(4000, 3000)).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1500 });
    expect(scaledDimensions(1000, 4000)).toEqual({ width: 500, height: MAX_IMAGE_DIMENSION });
  });

  it("rounds to whole pixels", () => {
    const { width, height } = scaledDimensions(4001, 3000);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });
});
