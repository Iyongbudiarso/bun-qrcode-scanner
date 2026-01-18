import { type NextRequest, NextResponse } from 'next/server';
import { Jimp } from 'jimp';
import QrCode from 'qrcode-reader';

export async function POST(req: NextRequest) {
  const allowedTokens = ((process.env.ACCESS_TOKENS || process.env.BUN_ACCESS_TOKENS) || '').split(',').filter(Boolean);
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers.get('x-access-token');

  if (allowedTokens.length > 0 && (!token || !allowedTokens.includes(token))) {
    return NextResponse.json({ errorMessage: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ errorMessage: "No file uploaded or invalid file type." }, { status: 400 });
    }

    // Read the image file buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Process the image with Jimp
    const img = await Jimp.read(buffer);
    const qr = new QrCode();

    // Use a callback function for the qrcode-reader decode method
    const value = await new Promise((resolve, reject) => {
      qr.callback = (err: any, value: { result: unknown; }) => {
        if (err) {
          reject(err);
        } else if (value) {
          resolve(value.result);
        } else {
          reject(new Error("QR code not found or could not be decoded."));
        }
      };
      qr.decode(img.bitmap);
    });

    return NextResponse.json({
      qrcode: value,
    });

  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ errorMessage: `${error.message}` }, { status: 500 });
  }
}
