import { type NextRequest, NextResponse } from 'next/server';
import { scanImage } from '@/lib/scanner';

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

    const result = await scanImage(buffer);

    return NextResponse.json({
      qrcode: result.text,
      format: result.format
    });

  } catch (error: any) {
    console.error("Scan error:", error);
    // Generic error handling if scan fails
    return NextResponse.json({ errorMessage: "Could not decode barcode. Ensure image is clear." }, { status: 400 });
  }
}
