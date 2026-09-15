/**
 * POST /api/client-errors
 *
 * Receives browser-side error reports from the client error reporter
 * (window.onerror / unhandledrejection) and logs them server-side.
 *
 * This makes browser-specific crashes visible in server logs without
 * waiting for user reports. Rate-limited to prevent abuse.
 *
 * Body: { message, stack, url, line, column, source, timestamp }
 */

import { NextRequest, NextResponse } from "next/server";
import { publicLimiter, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// In-memory ring buffer for recent errors (last 100)
const errorBuffer: Array<{
  message: string;
  url?: string;
  line?: number;
  source?: string;
  timestamp: string;
  count: number;
}> = [];
const MAX_BUFFER = 100;

export async function POST(request: NextRequest) {
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const body = await request.json();
    const { message, stack, url, line, column, source, timestamp } = body;

    if (!message) {
      return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
    }

    // Deduplicate: if the same error (message + url + line) arrived recently, bump count
    const key = `${message}|${url || ""}|${line || ""}`;
    const existing = errorBuffer.find(
      (e) => `${e.message}|${e.url || ""}|${e.line || ""}` === key
    );

    if (existing) {
      existing.count++;
      existing.timestamp = timestamp || new Date().toISOString();
    } else {
      errorBuffer.push({
        message: message.slice(0, 500),
        url,
        line,
        source,
        timestamp: timestamp || new Date().toISOString(),
        count: 1,
      });
      if (errorBuffer.length > MAX_BUFFER) {
        errorBuffer.shift();
      }
    }

    // Log to server console for visibility
    console.error(
      `[CLIENT_ERROR] ${source || "unknown"}: ${message}` +
      (url ? ` at ${url}:${line || "?"}:${column || "?"}` : "") +
      (existing ? ` (×${existing.count})` : "")
    );

    if (stack && process.env.NODE_ENV === "development") {
      console.error(`  stack: ${stack.slice(0, 300)}`);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// GET endpoint to retrieve recent errors (admin use)
export async function GET() {
  return NextResponse.json({
    errors: errorBuffer.slice(-50).reverse(),
    total: errorBuffer.length,
  });
}
