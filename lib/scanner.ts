import { Jimp } from 'jimp';
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
       // Calculate luminance: 0.2126 R + 0.7152 G + 0.0722 B
       // Approximation: (r+r+b+g+g+g)/6 is simple
       // Better approx: (306*R + 601*G + 117*B) >> 10
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

export async function scanImage(buffer: Buffer): Promise<ScanResult> {
  // Process the image with Jimp
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

  // Helper to attempt decoding with a specific binarizer
  const tryDecode = (luminanceSource: LuminanceSource, binarizer: any) => {
      try {
        const binaryBitmap = new BinaryBitmap(new binarizer(luminanceSource));
        return reader.decode(binaryBitmap, hints);
      } catch (e) {
        return null;
      }
  };

  // Strategy 1: Standard
  // We use our custom JimpLuminanceSource which handles the RGBA -> Luminance conversion correctly
  let luminanceSource = new JimpLuminanceSource(img);
  let result = tryDecode(luminanceSource, HybridBinarizer);

  // Strategy 2: GlobalHistogramBinarizer
  if (!result) {
      result = tryDecode(luminanceSource, GlobalHistogramBinarizer);
  }

  // Strategy 3: Invert colors
  if (!result) {
      img.invert();
      luminanceSource = new JimpLuminanceSource(img);

      result = tryDecode(luminanceSource, HybridBinarizer);

      if (!result) {
            result = tryDecode(luminanceSource, GlobalHistogramBinarizer);
      }
  }

  if (result) {
      return {
          text: result.getText(),
          format: BarcodeFormat[result.getBarcodeFormat()]
      };
  } else {
      throw new Error("Could not decode barcode using any strategy.");
  }
}
