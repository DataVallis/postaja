// Every uploaded image is decoded and re-encoded by sharp (TASK-005b, ADR-033): strips metadata (EXIF/GPS),
// applies EXIF orientation, caps the size and drops anything that is not a real image.
import sharp from "sharp";

/** Decompression-bomb guard: images above this many pixels are refused before decoding. */
export const MAX_INPUT_PIXELS = 40_000_000;

export type ReencodedImage = { bytes: Uint8Array; ext: "png" | "jpg"; contentType: "image/png" | "image/jpeg"; width: number; height: number };

/**
 * Logos stay PNG (transparency, crisp edges for overlays) with the longest side ≤ 2048 px.
 * Other images: PNG if they have transparency, otherwise JPEG q90; longest side ≤ 4096 px. Throws IMAGE_INVALID.
 */
export async function reencodeImage(input: Uint8Array, purpose: "logo" | "image"): Promise<ReencodedImage> {
  const max = purpose === "logo" ? 2048 : 4096;
  try {
    const img = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    const meta = await img.metadata();
    const png = purpose === "logo" || meta.hasAlpha === true;
    const pipeline = img.resize({ width: max, height: max, fit: "inside", withoutEnlargement: true });
    const { data, info } = png
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return {
      bytes: new Uint8Array(data),
      ext: png ? "png" : "jpg",
      contentType: png ? "image/png" : "image/jpeg",
      width: info.width,
      height: info.height,
    };
  } catch {
    throw new Error("IMAGE_INVALID");
  }
}
