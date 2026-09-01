/**
 * retryFetch — wraps the native fetch with automatic retry + exponential backoff.
 *
 * Usage:
 *   import { retryFetch } from "./retryFetch";
 *   const data = await retryFetch("/api/rooms", { headers: { Authorization: `Bearer ${token}` } });
 *
 * Options (3rd arg):
 *   retries    — max retry attempts (default: 3)
 *   baseDelay  — initial delay in ms (default: 500)
 *   maxDelay   — cap for backoff in ms (default: 8000)
 *   retryOn    — function(status, err) => boolean — decide per-response whether to retry
 */
export async function retryFetch(url, fetchOptions = {}, opts = {}) {
  const {
    retries = 3,
    baseDelay = 500,
    maxDelay = 8000,
    retryOn,
  } = opts;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);

      // Decide if we should retry on this status
      const shouldRetry = retryOn
        ? retryOn(response.status, null)
        : isRetryableStatus(response.status);

      if (response.ok || !shouldRetry) {
        return response;
      }

      // For retryable error statuses, read and discard the body so the
      // connection is properly released before the next attempt.
      try { await response.text(); } catch (_) {}

      lastError = new Error(`HTTP ${response.status}: ${response.statusText || url}`);

      if (attempt < retries) {
        await delay(attempt, baseDelay, maxDelay);
      }
    } catch (err) {
      lastError = err;

      // Network errors are always retryable
      const shouldRetry = retryOn
        ? retryOn(0, err)
        : isNetworkError(err);

      if (!shouldRetry || attempt >= retries) {
        throw err;
      }

      await delay(attempt, baseDelay, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Safe JSON fetch — calls retryFetch then parses the JSON body.
 * Returns { ok, status, data, error } instead of throwing on non-2xx.
 *
 * Usage:
 *   const { ok, data, error } = await safeJsonFetch("/api/rooms");
 *   if (ok) setRooms(data);
 *   else setError(error);
 */
export async function safeJsonFetch(url, fetchOptions = {}, retryOpts = {}) {
  try {
    const r = await retryFetch(url, fetchOptions, retryOpts);
    const t = await r.text();
    let data = null;
    if (t) {
      try { data = JSON.parse(t); } catch (_) {
        return { ok: false, status: r.status, data: null, error: "Server returned invalid JSON" };
      }
    }
    if (!r.ok) {
      return { ok: false, status: r.status, data: null, error: data?.message || `Request failed (${r.status})` };
    }
    return { ok: true, status: r.status, data, error: null };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message || "Network error" };
  }
}

// ─── Internal helpers ──────────────────────────────────────────

/** Exponential backoff with jitter */
function delay(attempt, baseDelay, maxDelay) {
  const exp = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = exp * (0.5 + Math.random() * 0.5); // 50-100% of exp
  return new Promise((resolve) => setTimeout(resolve, jitter));
}

/** Which HTTP statuses are safe to retry */
function isRetryableStatus(status) {
  // 408 = Request Timeout, 429 = Too Many Requests, 502/503/504 = Gateway errors
  return [408, 429, 502, 503, 504].includes(status);
}

/** Which errors are network-related and safe to retry */
function isNetworkError(err) {
  if (!err) return false;
  const msg = err.message?.toLowerCase() || "";
  return (
    err.name === "TypeError" ||          // "Failed to fetch" / network offline
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("failed to fetch")
  );
}
