/**
 * Sentry Client Configuration
 *
 * Initialize Sentry for error tracking + performance monitoring.
 * DSN is read from VITE_SENTRY_DSN env var (set in .env or .env.local).
 *
 * To enable:
 *   1. Create a Sentry project at https://sentry.io
 *   2. Copy the DSN from Project Settings → Client Keys (DSN)
 *   3. Add VITE_SENTRY_DSN=https://your-dsn@sentry.io/project-id
 *      to frontend/.env.local
 *   4. Run `npm run build` to upload source maps (optional)
 */
import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN;
const ENV = import.meta.env.MODE || import.meta.env.VITE_APP_ENV || "development";

// Only initialize if DSN is provided (avoids errors in local dev)
if (DSN) {
  Sentry.init({
    dsn: DSN,

    // Environment & release
    environment: ENV,
    release: import.meta.env.VITE_APP_VERSION || "1.0.0",

    // Sample rates — tune these for your traffic volume
    tracesSampleRate: ENV === "production" ? 0.2 : 1.0, // 20% of transactions in prod
    replaysSessionSampleRate: 0.1,   // 10% of sessions get replay
    replaysOnErrorSampleRate: 1.0,   // 100% of error sessions get replay

    // Enable session replay on errors
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,           // Mask all text in replays (privacy)
        blockAllMedia: false,        // Allow images
        maskAllInputs: true,         // Mask form inputs (passwords, etc.)
      }),
    ],

    // Breadcrumbs — what gets attached to errors
    enableTracing: true,
    attachStacktrace: true,
    sendDefaultPii: false,           // Don't send personally identifiable info

    // Ignore known non-actionable errors
    denyUrls: [
      /chrome-extension:/i,
      /moz-extension:/i,
      /safari-web-extension:/i,
      /localhost:\d+\/@vite\/client/, // Vite HMR client
    ],

    // Ignore specific errors
    ignoreErrors: [
      "ResizeObserver loop completed with undelivered notifications",
      "NetworkError",
      "Non-Error promise rejection captured",
      "Script error.",               // Cross-origin script errors
      "Loading chunk",
      "Failed to fetch dynamically imported module",
    ],

    // Before send hook — sanitize sensitive data
    beforeSend(event, hint) {
      // Strip authorization headers from error reports
      if (event.request?.headers) {
        delete event.request.headers["Authorization"];
        delete event.request.headers["authorization"];
      }

      // Strip tokens from URLs in breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((bc) => {
          if (bc.data?.url) {
            bc.data.url = bc.data.url.replace(/[?&]token=[^&]+/g, "");
          }
          return bc;
        });
      }

      return event;
    },

    // Log initialization
    debug: ENV === "development",
  });

  console.log(`[Sentry] Initialized (environment: ${ENV})`);
} else {
  console.log("[Sentry] Disabled — no VITE_SENTRY_DSN configured");
}

export default Sentry;
