// Client-side receipt photo shrinking: phone camera shots are 5-12MB, which
// would bloat the DB fast. Re-encode to JPEG capped at 2000px on the long
// edge before upload. Falls back to the original file whenever the browser
// can't decode it (e.g. HEIC outside Safari) - the server cap still applies.

export const MAX_IMAGE_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

const DOWNSCALABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export function shouldDownscale(mimeType: string): boolean {
  return DOWNSCALABLE.has(mimeType);
}

export function scaledDimensions(
  width: number,
  height: number,
  max = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function downscaleImage(file: File): Promise<File> {
  if (!shouldDownscale(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    // Keep the original when re-encoding didn't actually help.
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
