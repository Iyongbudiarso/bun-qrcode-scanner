import { Jimp } from 'jimp';
import sharp from 'sharp';
import { scanGrayBuffer } from '@undecaf/zbar-wasm';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  BinaryBitmap,
  HybridBinarizer,
  GlobalHistogramBinarizer,
  LuminanceSource,
  InvertedLuminanceSource
} from '@zxing/library';

export interface ScanResult {
  text: string;
  format: string;
}

// ─── Phase 1: Jimp + ZXing (original, fast path) ────────────────────────

class JimpLuminanceSource extends LuminanceSource {
  constructor(private image: any) {
    super(image.bitmap.width, image.bitmap.height);
  }

  getRow(y: number, row?: Uint8ClampedArray): Uint8ClampedArray {
    if (y < 0 || y >= this.getHeight()) {
      throw new Error('Requested row is outside the image: ' + y);
    }
    const width = this.getWidth();
    if (!row || row.length < width) {
      row = new Uint8ClampedArray(width);
    }
    const offset = y * width * 4;
    const data = this.image.bitmap.data;

    for (let x = 0; x < width; x++) {
       const pos = offset + (x * 4);
       const r = data[pos];
       const g = data[pos + 1];
       const b = data[pos + 2];
       // Calculate luminance: (306*R + 601*G + 117*B) >> 10
       row[x] = (306 * r + 601 * g + 117 * b) >> 10;
    }
    return row;
  }

  getMatrix(): Uint8ClampedArray {
    const width = this.getWidth();
    const height = this.getHeight();
    const matrix = new Uint8ClampedArray(width * height);
    const data = this.image.bitmap.data;
    for (let y = 0; y < height; y++) {
      const offset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const pos = offset + (x * 4);
        const r = data[pos];
        const g = data[pos + 1];
        const b = data[pos + 2];
        matrix[y * width + x] = (306 * r + 601 * g + 117 * b) >> 10;
      }
    }
    return matrix;
  }

  invert(): LuminanceSource {
    return new InvertedLuminanceSource(this);
  }
}

/**
 * Attempts to decode a barcode from a Jimp image using multiple binarizer strategies.
 * Tries normal and inverted luminance with both HybridBinarizer and GlobalHistogramBinarizer.
 */
function tryDecodeImage(img: any, reader: MultiFormatReader, hints: Map<DecodeHintType, any>): any | null {
  const luminanceSource = new JimpLuminanceSource(img);

  // Try HybridBinarizer (best for most cases)
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
    return reader.decode(bitmap, hints);
  } catch (_) {}

  // Try GlobalHistogramBinarizer (better for low-contrast images)
  try {
    const bitmap = new BinaryBitmap(new GlobalHistogramBinarizer(luminanceSource));
    return reader.decode(bitmap, hints);
  } catch (_) {}

  // Try inverted luminance + HybridBinarizer
  try {
    const inverted = luminanceSource.invert();
    const bitmap = new BinaryBitmap(new HybridBinarizer(inverted));
    return reader.decode(bitmap, hints);
  } catch (_) {}

  // Try inverted luminance + GlobalHistogramBinarizer
  try {
    const inverted = luminanceSource.invert();
    const bitmap = new BinaryBitmap(new GlobalHistogramBinarizer(inverted));
    return reader.decode(bitmap, hints);
  } catch (_) {}

  return null;
}

/**
 * Creates multiple preprocessed variants of the image for scanning.
 * Each variant applies different image processing to maximize decode success.
 */
function createImageVariants(img: any): Array<{ label: string; image: any }> {
  const variants: Array<{ label: string; image: any }> = [];

  // Variant 1: Original image (no preprocessing)
  variants.push({ label: 'original', image: img.clone() });

  // Variant 2: Greyscale (removes color noise)
  const grey = img.clone().greyscale();
  variants.push({ label: 'greyscale', image: grey });

  // Variant 3: High contrast (sharpens barcode edges)
  const highContrast = img.clone().contrast(0.5);
  variants.push({ label: 'high-contrast', image: highContrast });

  // Variant 4: Greyscale + high contrast combined
  const greyContrast = img.clone().greyscale().contrast(0.5);
  variants.push({ label: 'greyscale+contrast', image: greyContrast });

  return variants;
}

// ─── Phase 2: Sharp + ZBar-WASM fallback ────────────────────────────────

class GrayLuminanceSource extends LuminanceSource {
  constructor(private gray: Uint8ClampedArray, w: number, h: number) {
    super(w, h);
  }
  getRow(y: number, row?: Uint8ClampedArray): Uint8ClampedArray {
    const w = this.getWidth();
    if (!row || row.length < w) row = new Uint8ClampedArray(w);
    const off = y * w;
    for (let x = 0; x < w; x++) row[x] = this.gray[off + x];
    return row;
  }
  getMatrix(): Uint8ClampedArray { return this.gray; }
  invert(): LuminanceSource { return new InvertedLuminanceSource(this); }
}

/**
 * Fallback scanner using sharp for preprocessing and ZBar-WASM + ZXing for decoding.
 * Only called when the primary Jimp + ZXing pipeline fails.
 */
async function scanWithSharpFallback(buffer: Buffer): Promise<ScanResult | null> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 576;

  const rotations = [0, 90, 180, 270];

  const preprocessors: Array<{ label: string; fn: (s: sharp.Sharp) => sharp.Sharp }> = [
    { label: 'original',     fn: (s) => s },
    { label: 'normalize',    fn: (s) => s.normalize() },
    { label: 'sharpen',      fn: (s) => s.sharpen({ sigma: 3 }) },
    { label: 'norm+sharpen', fn: (s) => s.normalize().sharpen({ sigma: 3 }) },
    { label: 'clahe',        fn: (s) => s.clahe({ width: 3, height: 3 }) },
    { label: 'high-contrast',fn: (s) => s.linear(2, -128) },
  ];

  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.CODE_128,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_39,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.AZTEC,
    BarcodeFormat.PDF_417,
    BarcodeFormat.ITF,
  ]);
  const reader = new MultiFormatReader();

  // Phase 2a: Sharp preprocessing × rotations (1× scale)
  for (const pp of preprocessors) {
    for (const deg of rotations) {
      try {
        let pipeline = pp.fn(sharp(buffer));
        if (deg !== 0) pipeline = pipeline.rotate(deg);

        const { data, info } = await pipeline.greyscale().raw()
          .toBuffer({ resolveWithObject: true });

        // Try ZBar first (faster, more robust for 1D barcodes)
        const zbarResults = await scanGrayBuffer(
          new Uint8Array(data).buffer, info.width, info.height
        );
        if (zbarResults.length > 0) {
          const decoded = zbarResults[0].decode();
          console.log(`[fallback] ZBar decoded (${pp.label}, ${deg}°): ${decoded}`);
          return { text: decoded, format: zbarResults[0].typeName };
        }

        // Try ZXing with grayscale buffer
        const gray = new Uint8ClampedArray(data);
        const src = new GrayLuminanceSource(gray, info.width, info.height);
        for (const makeBitmap of [
          () => new BinaryBitmap(new HybridBinarizer(src)),
          () => new BinaryBitmap(new GlobalHistogramBinarizer(src)),
          () => new BinaryBitmap(new HybridBinarizer(src.invert())),
          () => new BinaryBitmap(new GlobalHistogramBinarizer(src.invert())),
        ]) {
          try {
            const result = reader.decode(makeBitmap(), hints);
            const text = result.getText();
            console.log(`[fallback] ZXing decoded (${pp.label}, ${deg}°): ${text}`);
            return { text, format: BarcodeFormat[result.getBarcodeFormat()] };
          } catch (_) {}
        }
      } catch (_) {}
    }
  }

  // Phase 2b: Upscaled image × preprocessors × rotations
  for (const scaleFactor of [2, 3]) {
    for (const pp of preprocessors) {
      for (const deg of rotations) {
        try {
          let pipeline = sharp(buffer)
            .resize({ width: Math.round(w * scaleFactor), kernel: 'lanczos3' });
          if (deg !== 0) pipeline = pipeline.rotate(deg);
          pipeline = pp.fn(pipeline);

          const { data, info } = await pipeline.greyscale().raw()
            .toBuffer({ resolveWithObject: true });

          // Try ZBar
          const zbarResults = await scanGrayBuffer(
            new Uint8Array(data).buffer, info.width, info.height
          );
          if (zbarResults.length > 0) {
            const decoded = zbarResults[0].decode();
            console.log(`[fallback] ZBar decoded (${scaleFactor}×, ${pp.label}, ${deg}°): ${decoded}`);
            return { text: decoded, format: zbarResults[0].typeName };
          }

          // Try ZXing
          const gray = new Uint8ClampedArray(data);
          const src = new GrayLuminanceSource(gray, info.width, info.height);
          for (const makeBitmap of [
            () => new BinaryBitmap(new HybridBinarizer(src)),
            () => new BinaryBitmap(new GlobalHistogramBinarizer(src)),
          ]) {
            try {
              const result = reader.decode(makeBitmap(), hints);
              const text = result.getText();
              console.log(`[fallback] ZXing decoded (${scaleFactor}×, ${pp.label}, ${deg}°): ${text}`);
              return { text, format: BarcodeFormat[result.getBarcodeFormat()] };
            } catch (_) {}
          }
        } catch (_) {}
      }
    }
  }

  return null;
}

// ─── Main scan function ─────────────────────────────────────────────────

/**
 * Scans a barcode/QR code from an image buffer.
 *
 * Uses a multi-strategy pipeline to maximize decode success:
 *
 * **Phase 1** (Jimp + ZXing) – Fast path for simple images:
 * 1. Multiple image preprocessing variants (original, greyscale, high contrast, combined)
 * 2. Multiple rotation angles (0°, 90°, 180°, 270°) for rotated barcodes
 * 3. Multiple binarizer strategies (Hybrid, GlobalHistogram)
 * 4. Inverted luminance for each combination
 *
 * **Phase 2** (Sharp + ZBar/ZXing) – Fallback for difficult images:
 * 1. Advanced preprocessing (normalize, sharpen, CLAHE, high contrast)
 * 2. ZBar-WASM engine (more robust for distorted 1D barcodes)
 * 3. Upscaled versions (2×, 3×) for low-resolution images
 *
 * Short-circuits on the first successful decode.
 */
export async function scanImage(buffer: Buffer): Promise<ScanResult> {
  // ── Phase 1: Jimp + ZXing (fast path) ──
  const img = await Jimp.read(buffer);

  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.CODE_128,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_39,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.AZTEC,
    BarcodeFormat.PDF_417,
    BarcodeFormat.ITF
  ]);

  const reader = new MultiFormatReader();
  const rotations = [0, 90, 180, 270];

  // Create preprocessed image variants
  const variants = createImageVariants(img);

  // Try each variant × rotation × binarizer combination
  for (const variant of variants) {
    for (const deg of rotations) {
      const rotatedImg = variant.image.clone();
      if (deg !== 0) {
        rotatedImg.rotate(deg);
      }

      const result = tryDecodeImage(rotatedImg, reader, hints);
      if (result) {
        console.log(`Decoded with strategy: ${variant.label}, rotation: ${deg}°`);
        return {
          text: result.getText(),
          format: BarcodeFormat[result.getBarcodeFormat()]
        };
      }
    }
  }

  // ── Phase 2: Sharp + ZBar-WASM fallback (for difficult images) ──
  console.log('[scanner] Phase 1 failed, trying sharp + zbar fallback...');
  const fallbackResult = await scanWithSharpFallback(buffer);
  if (fallbackResult) {
    return fallbackResult;
  }

  throw new Error("Could not decode barcode using any strategy.");
}
