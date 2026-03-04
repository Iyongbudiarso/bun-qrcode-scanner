import { type NextRequest, NextResponse } from "next/server";
import { scanImage } from "@/lib/scanner";
import { validateToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = validateToken(req);
  if (authError) return authError;

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { errorMessage: "No file uploaded or invalid file type." },
        { status: 400 },
      );
    }

    // Read the image file buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await scanImage(buffer);

    return NextResponse.json({
      qrcode: result.text,
      format: result.format,
    });
  } catch (error) {
    console.error("Scan error:", error);
    // Generic error handling if scan fails
    return NextResponse.json(
      { errorMessage: "Could not decode barcode. Ensure image is clear." },
      { status: 400 },
    );
  }
}
