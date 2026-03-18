import sharp from "sharp";
import Tesseract from "tesseract.js";

/**
 * Preprocess a CAPTCHA image to remove diagonal lines and noise,
 * then extract text using Tesseract OCR.
 *
 * Pipeline:
 *  1. Grayscale → binarize (threshold)
 *  2. Connected-component analysis: find all black pixel blobs
 *  3. Remove blobs that are "line-like" (very elongated aspect ratio)
 *     while keeping compact character-stroke blobs
 *  4. OCR with tesseract.js (single-line mode, alphanumeric whitelist)
 */
export async function extractTextFromImage(
  imageBuffer: Buffer,
): Promise<string> {
  // --- Step 1: Grayscale + binarize ---
  const { data: rawData, info } = await sharp(imageBuffer)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .threshold(110)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const pixels = new Uint8Array(rawData);

  // --- Step 2: Connected-component blob detection via BFS flood-fill ---
  const visited = new Uint8Array(width * height);
  function getPixel(x: number, y: number): number { return pixels[y * width + x]; }
  function setPixel(x: number, y: number, value: number): void { pixels[y * width + x] = value; }

  function bfsBlob(startX: number, startY: number): [number, number][] {
    const blob: [number, number][] = [];
    const queue: [number, number][] = [[startX, startY]];
    visited[startY * width + startX] = 1;
    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      blob.push([cx, cy]);
      for (const [nx, ny] of [[cx-1, cy], [cx+1, cy], [cx, cy-1], [cx, cy+1]]) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (visited[ny * width + nx]) continue;
        if (getPixel(nx, ny) === 0) {
          visited[ny * width + nx] = 1;
          queue.push([nx, ny]);
        }
      }
    }
    return blob;
  }

  const blobs: [number, number][][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!visited[y * width + x] && getPixel(x, y) === 0) {
        blobs.push(bfsBlob(x, y));
      }
    }
  }

  // --- Step 4: Filter out line-like blobs ---
  for (const blob of blobs) {
    if (blob.length < 5) {
      for (const [x, y] of blob) setPixel(x, y, 255);
      continue;
    }

    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (const [x, y] of blob) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }

    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    const aspectRatio = Math.max(bboxW, bboxH) / (Math.min(bboxW, bboxH) || 1);
    const isLine = aspectRatio > 4.0;
    const isBorder = bboxW > width * 0.9 || bboxH > height * 0.9;

    if (isLine || isBorder) {
      // Instead of erasing the whole blob, selectively erase pixels that look like horizontal lines
      for (const [x, y] of blob) {
        let hasVertical = false;
        // Check vertical neighbors within +/- 5 pixels
        for (let dy = -5; dy <= 5; dy++) {
          if (dy === 0) continue;
          const ny = y + dy;
          if (ny >= 0 && ny < height && getPixel(x, ny) === 0) {
            hasVertical = true;
            break;
          }
        }
        if (!hasVertical) {
          setPixel(x, y, 255);
        }
      }
    }
  }

  // --- Step 5: OCR with tesseract.js ---
  const cleanedBuffer = await sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 1 },
  }).png().toBuffer();

  const worker = await Tesseract.createWorker("eng", 1, {
    corePath: "https://unpkg.com/tesseract.js-core@7.0.0/tesseract-core.wasm.js",
    logger: m => console.log(m),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  });

  const { data: { text } } = await worker.recognize(cleanedBuffer);
  await worker.terminate();
  return text.replace(/\s+/g, "").toLowerCase();
}
