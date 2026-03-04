import { type NextRequest, NextResponse } from "next/server";
import { validateToken } from "@/lib/auth";

async function getSignature(key: string, data: string) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(data),
  );

  // Convert to hex string
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * HMAC-SHA256 signing endpoint.
 * The secret key is provided by the caller — this is by design for
 * use cases where each client owns its own signing key.
 */
export async function POST(req: NextRequest) {
  const authError = validateToken(req);
  if (authError) return authError;

  try {
    const formData = await req.formData();
    const secretKey = formData.get("secret-key");
    const payload = formData.get("payload");

    if (
      !secretKey ||
      !payload ||
      typeof secretKey !== "string" ||
      typeof payload !== "string"
    ) {
      return NextResponse.json(
        {
          errorMessage:
            "Missing or invalid 'secret-key' and/or 'payload' fields.",
        },
        { status: 400 },
      );
    }

    const signature = await getSignature(secretKey, payload);

    return NextResponse.json({
      signature,
    });
  } catch (error) {
    console.error("HMAC signature error:", error);
    return NextResponse.json(
      { errorMessage: "Failed to generate signature." },
      { status: 500 },
    );
  }
}
