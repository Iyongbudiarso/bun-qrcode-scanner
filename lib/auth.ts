import { timingSafeEqual } from "crypto";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Performs a timing-safe string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validates the request token against the configured allowed tokens.
 * Supports both `Authorization: Bearer <token>` and `x-access-token` headers.
 *
 * When no tokens are configured (ACCESS_TOKENS / BUN_ACCESS_TOKENS are unset),
 * authentication is bypassed — all requests are allowed through.
 *
 * @returns A 401 NextResponse if unauthorized, or `null` if the request is valid.
 */
export function validateToken(req: NextRequest): NextResponse | null {
  const allowedTokens = (
    process.env.ACCESS_TOKENS ||
    process.env.BUN_ACCESS_TOKENS ||
    ""
  )
    .split(",")
    .filter(Boolean);

  if (allowedTokens.length === 0) {
    return null;
  }

  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.headers.get("x-access-token");

  if (!token || !allowedTokens.some((allowed) => safeCompare(allowed, token))) {
    return NextResponse.json({ errorMessage: "Unauthorized" }, { status: 401 });
  }

  return null;
}
