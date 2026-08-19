/**
 * Photographs travel to the contract as raw JPEG bytes inside the transaction,
 * so the browser has to get them small before they ever leave the page. The
 * contract's own ceiling is 260 KB; we aim well under it and step the quality
 * down until we fit.
 */

export const MAX_BYTES = 240_000;
const MAX_EDGE = 900;

export interface PreparedImage {
  bytes: Uint8Array;
  previewUrl: string;
  width: number;
  height: number;
  originalBytes: number;
}

export async function prepareImage(file: File | Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable in this browser");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let blob: Blob | null = null;
  for (const quality of [0.82, 0.72, 0.62, 0.5, 0.4]) {
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) break;
  }
  if (!blob) throw new Error("could not encode the photograph");
  if (blob.size > MAX_BYTES) {
    throw new Error(
      `photograph is still ${Math.round(blob.size / 1024)} KB after compression — try a smaller crop`,
    );
  }

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
    originalBytes: (file as File).size ?? blob.size,
  };
}

/** Load one of the bundled demo specimens straight into the same shape. */
export async function prepareFromUrl(url: string): Promise<PreparedImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}`);
  return prepareImage(await res.blob());
}
