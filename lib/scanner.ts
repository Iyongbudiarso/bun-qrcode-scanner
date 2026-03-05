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

// ─── ZXing Luminance Source (grayscale buffer) ───────────────────────────

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

  getMatrix(): Uint8ClampedArray {
    return this.gray;
  }

  invert(): LuminanceSource {
    return new InvertedLuminanceSource(this);
  }
}

// ─── ZXing decode helper ────────────────────────────────────────────────

const ZXING_FORMATS = [
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
];

function tryZxingDecode(gray: Uint8ClampedArray, w: number, h: number): ScanResult | null {
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);

  const reader = new MultiFormatReader();
  const src = new GrayLuminanceSource(gray, w, h);

  const strategies = [
    () => new BinaryBitmap(new HybridBinarizer(src)),
    () => new BinaryBitmap(new GlobalHistogramBinarizer(src)),
    () => new BinaryBitmap(new HybridBinarizer(src.invert())),
    () => new BinaryBitmap(new GlobalHistogramBinarizer(src.invert())),
  ];

  for (const makeBitmap of strategies) {
    try {
      const result = reader.decode(makeBitmap(), hints);
      return {
        text: result.getText(),
        format: BarcodeFormat[result.getBarcodeFormat()],
      };
    } catch (_) {}
  }
  return null;
}

// ─── ZBar decode helper ─────────────────────────────────────────────────

async function tryZbarDecode(gray: Buffer, w: number, h: number): Promise<ScanResult | null> {
  const results = await scanGrayBuffer(new Uint8Array(gray).buffer, w, h);
  if (results.length > 0) {
    return {
      text: results[0].decode(),
      format: results[0].typeName,
    };
  }
  return null;
}

// ─── Preprocessing helpers ──────────────────────────────────────────────

/**
 * Convert a sharp pipeline to a single-channel grayscale raw buffer.
 */
async function toGray(pipeline: sharp.Sharp): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await pipeline
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/**
 * Try to decode a barcode from a sharp pipeline using both ZBar and ZXing.
 */
async function tryDecode(pipeline: sharp.Sharp): Promise<ScanResult | null> {
  const { data, w, h } = await toGray(pipeline);

  // ZBar is faster and more robust for most barcodes
  const zbarResult = await tryZbarDecode(data, w, h);
  if (zbarResult) return zbarResult;

  // Fall back to ZXing
  const gray = new Uint8ClampedArray(data);
  return tryZxingDecode(gray, w, h);
}

// ─── Image variant generators ───────────────────────────────────────────

type PreprocessFn = (s: sharp.Sharp) => sharp.Sharp;

const PREPROCESS_STRATEGIES: Array<{ label: string; fn: PreprocessFn }> = [
  { label: 'original',       fn: (s) => s },
  { label: 'normalize',      fn: (s) => s.normalize() },
  { label: 'sharpen',        fn: (s) => s.sharpen({ sigma: 3 }) },
  { label: 'norm+sharpen',   fn: (s) => s.normalize().sharpen({ sigma: 3 }) },
  { label: 'clahe',          fn: (s) => s.clahe({ width: 3, height: 3 }) },
  { label: 'high-contrast',  fn: (s) => s.linear(2, -128) },
];

const ROTATIONS = [0, 90, 180, 270];

// ─── Main scan function ─────────────────────────────────────────────────

/**
 * Scans a barcode/QR code from an image buffer.
 *
 * Uses a multi-engine, multi-strategy pipeline to maximize decode success:
 *
 * **Phase 1** – Quick scan (ZBar + ZXing, original image, all rotations)
 * **Phase 2** – Preprocessed variants (normalize, sharpen, CLAHE, contrast) × rotations
 * **Phase 3** – Upscaled image (2×, 3×) × preprocessors × rotations
 *
 * ZBar (via WebAssembly) is tried first as it handles rotated and distorted
 * barcodes better. ZXing is used as a fallback.
 *
 * Short-circuits on the first successful decode.
 */
export async function scanImage(buffer: Buffer): Promise<ScanResult> {
  const inputBuf = buffer;
  const meta = await sharp(inputBuf).metadata();
  const w = meta.width || 576;

  // ── Phase 1: Quick scan with original image + rotations ──
  for (const deg of ROTATIONS) {
    const pipeline = sharp(inputBuf);
    if (deg !== 0) pipeline.rotate(deg);

    const result = await tryDecode(pipeline);
    if (result) {
      console.log(`[scanner] Decoded (phase 1, ${deg}°): ${result.text}`);
      return result;
    }
  }

  // ── Phase 2: Preprocessed variants × rotations ──
  // Skip 'original' since Phase 1 already tried it
  for (const pp of PREPROCESS_STRATEGIES.slice(1)) {
    for (const deg of ROTATIONS) {
      try {
        const pipeline = pp.fn(sharp(inputBuf));
        if (deg !== 0) pipeline.rotate(deg);

        const result = await tryDecode(pipeline);
        if (result) {
          console.log(`[scanner] Decoded (phase 2, ${pp.label}, ${deg}°): ${result.text}`);
          return result;
        }
      } catch (_) {}
    }
  }

  // ── Phase 3: Upscaled image × preprocessors × rotations ──
  for (const scaleFactor of [2, 3]) {
    for (const pp of PREPROCESS_STRATEGIES) {
      for (const deg of ROTATIONS) {
        try {
          let pipeline = sharp(inputBuf)
            .resize({ width: Math.round(w * scaleFactor), kernel: 'lanczos3' });
          if (deg !== 0) pipeline = pipeline.rotate(deg);
          pipeline = pp.fn(pipeline);

          const result = await tryDecode(pipeline);
          if (result) {
            console.log(`[scanner] Decoded (phase 3, ${scaleFactor}×, ${pp.label}, ${deg}°): ${result.text}`);
            return result;
          }
        } catch (_) {}
      }
    }
  }

  throw new Error('Could not decode barcode using any strategy.');
}
