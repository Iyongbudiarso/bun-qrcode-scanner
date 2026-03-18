import { type NextRequest, NextResponse } from "next/server";
import { validateToken } from "@/lib/auth";
import { extractTextFromImage } from "@/lib/ocr";

export async function POST(req: NextRequest) {
  const authError = validateToken(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const base64: string | undefined = body?.base64;

    if (!base64 || typeof base64 !== "string") {
      return NextResponse.json(
        { errorMessage: "Missing or invalid 'base64' field." },
        { status: 400 },
      );
    }

    // Decode base64 to a raw image buffer
    const imageBuffer = Buffer.from(base64, "base64");

    const text = await extractTextFromImage(imageBuffer);

    return NextResponse.json({ text });
  } catch (error) {
    console.error("OCR error:", error);
    return NextResponse.json(
      { errorMessage: "Failed to extract text from image." },
      { status: 500 },
    );
  }
}
