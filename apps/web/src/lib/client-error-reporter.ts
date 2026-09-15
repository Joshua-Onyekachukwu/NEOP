/**
 * Client-side Error Reporter
 *
 * Hooks into window.onerror and unhandledrejection to capture browser
 * crashes and POST them to /api/client-errors for server-side logging.
 *
 * Usage: import "@lib/client-error-reporter" once at the app root.
 * The reporter initializes itself as a side effect and runs silently.
 *
 * Rate-limited: at most one error report per 5 seconds to avoid
 * flooding the API during rapid-fire errors (e.g., a broken WebSocket
 * reconnecting in a loop).
 */

const REPORT_ENDPOINT = "/api/client-errors";
const MIN_INTERVAL_MS = 5_000;
const MAX_STACK_LENGTH = 500;

let lastReportTime = 0;
let initialized = false;

function reportError(
  source: string,
  message: string,
  stack?: string,
  url?: string,
  line?: number,
  column?: number
) {
  // Rate-limit
  const now = Date.now();
  if (now - lastReportTime < MIN_INTERVAL_MS) return;
  lastReportTime = now;

  // Don't report trivial errors
  if (
    message.includes("ResizeObserver loop") ||
    message.includes("Non-Error promise rejection") ||
    message.includes("Loading chunk") ||
    message.includes("Network request failed") ||
    message.includes("ChunkLoadError")
  ) {
    return;
  }

  const body = {
    message: message.slice(0, 500),
    stack: stack?.slice(0, MAX_STACK_LENGTH),
    url,
    line,
    column,
    source,
    timestamp: new Date().toISOString(),
  };

  // Use sendBeacon for reliability (works even if the page is unloading),
  // fall back to fetch if sendBeacon is unavailable.
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
      navigator.sendBeacon(REPORT_ENDPOINT, blob);
    } else {
      fetch(REPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Reporter must never throw
  }
}

function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // Synchronous errors (uncaught exceptions)
  window.onerror = (
    message: string | Event,
    source?: string,
    line?: number,
    column?: number,
    error?: Error
  ) => {
    const msg = typeof message === "string" ? message : message.type;
    reportError(
      "onerror",
      msg,
      error?.stack,
      source,
      line,
      column
    );
  };

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    let message: string;
    let stack: string | undefined;

    if (reason instanceof Error) {
      message = reason.message;
      stack = reason.stack;
    } else if (typeof reason === "string") {
      message = reason;
    } else {
      try {
        message = JSON.stringify(reason);
      } catch {
        message = String(reason);
      }
    }

    reportError("unhandledrejection", message, stack);
  });

  // React error boundary fallback (optional: call reportError from ErrorBoundary)
  (window as any).__NEOP_REPORT_ERROR = reportError;
}

// Auto-initialize on import
init();

export { reportError };
