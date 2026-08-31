/**
 * CDN-friendly cache header helpers for public API endpoints.
 *
 * Uses s-maxage for CDN/edge caching and stale-while-revalidate
 * so users always get a fast response while fresh data loads in background.
 */

import { NextResponse } from "next/server";

/**
 * Aggressive CDN cache for data that changes rarely.
 * CDN caches for 5 minutes, serves stale for up to 10 more minutes.
 */
export function cachePublicStatic(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  return response;
}

/**
 * Moderate CDN cache for data that updates periodically.
 * CDN caches for 30 seconds, serves stale for up to 2 minutes.
 * Good for stats, config, party results that update after simulation.
 */
export function cachePublicModerate(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=120"
  );
  return response;
}

/**
 * Short CDN cache for frequently-changing data.
 * CDN caches for 10 seconds, stale for 30 seconds.
 * Good for results feed, status changes, disruptions.
 */
export function cachePublicShort(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=10, stale-while-revalidate=30"
  );
  return response;
}

/**
 * No cache — data must always be fresh.
 * Use for write operations, auth endpoints, admin endpoints.
 */
export function noCache(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return response;
}

/**
 * Private cache — browser caches for 5 seconds, CDN does not.
 * Good for authenticated user-specific responses.
 */
export function cachePrivate(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, max-age=5");
  return response;
}

/**
 * Wrap a JSON response with cache headers.
 */
export function cachedJson(data: any, cacheLevel: "static" | "moderate" | "short" | "none" = "moderate"): NextResponse {
  const response = NextResponse.json(data);
  switch (cacheLevel) {
    case "static":
      return cachePublicStatic(response);
    case "moderate":
      return cachePublicModerate(response);
    case "short":
      return cachePublicShort(response);
    case "none":
      return noCache(response);
  }
}
