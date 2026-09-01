import React from "react";

/**
 * Global Error Boundary — catches JavaScript errors anywhere in the
 * child component tree, displays a fallback UI, and logs the error.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 * Props:
 *   fallbackTitle  — custom title for the error screen
 *   onError        — callback(error, errorInfo) for external logging
 *   children
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console for dev
    console.error("[ErrorBoundary]", error, errorInfo);
    // External logging callback (e.g. Sentry, LogRocket)
    if (typeof this.props.onError === "function") {
      try { this.props.onError(error, errorInfo); } catch (_) {}
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      const title = this.props.fallbackTitle || "Something went wrong";
      const isDev = typeof process !== "undefined" && process.env?.NODE_ENV === "development";

      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            padding: "24px",
          }}
        >
          <div
            style={{
              maxWidth: "520px",
              width: "100%",
              background: "rgba(30, 41, 59, 0.8)",
              backdropFilter: "blur(16px)",
              borderRadius: "24px",
              border: "1px solid rgba(255,255,255,0.08)",
              padding: "48px 40px",
              textAlign: "center",
              boxShadow: "0 25px 60px rgba(0,0,0,0.4)",
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #ef4444, #dc2626)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 24px",
                fontSize: "32px",
                boxShadow: "0 8px 24px rgba(239,68,68,0.3)",
              }}
            >
              ⚠️
            </div>

            {/* Title */}
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "#f1f5f9",
                margin: "0 0 8px",
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </h1>

            {/* Error message */}
            <p
              style={{
                fontSize: "14px",
                color: "#94a3b8",
                margin: "0 0 24px",
                lineHeight: 1.6,
              }}
            >
              An unexpected error occurred while running the application.
              <br />
              Your data has not been lost.
            </p>

            {/* Error details (dev only) */}
            {isDev && error && (
              <details
                style={{
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "12px",
                  padding: "16px",
                  marginBottom: "24px",
                  textAlign: "left",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <summary
                  style={{
                    color: "#fbbf24",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    marginBottom: "8px",
                  }}
                >
                  Error Details (Development)
                </summary>
                <pre
                  style={{
                    color: "#fca5a5",
                    fontSize: "11px",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    maxHeight: "200px",
                    overflow: "auto",
                  }}
                >
                  {error.message}
                  {"\n\n"}
                  {errorInfo?.componentStack}
                </pre>
              </details>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                onClick={this.handleRetry}
                style={{
                  padding: "12px 28px",
                  borderRadius: "12px",
                  border: "none",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  boxShadow: "0 4px 12px rgba(99,102,241,0.3)",
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = "translateY(-1px)";
                  e.target.style.boxShadow = "0 6px 20px rgba(99,102,241,0.4)";
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = "translateY(0)";
                  e.target.style.boxShadow = "0 4px 12px rgba(99,102,241,0.3)";
                }}
              >
                Try Again
              </button>
              <button
                onClick={this.handleGoHome}
                style={{
                  padding: "12px 28px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#94a3b8",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseOver={(e) => {
                  e.target.style.background = "rgba(255,255,255,0.1)";
                  e.target.style.color = "#e2e8f0";
                }}
                onMouseOut={(e) => {
                  e.target.style.background = "rgba(255,255,255,0.05)";
                  e.target.style.color = "#94a3b8";
                }}
              >
                Go Home
              </button>
            </div>

            {/* Footer note */}
            <p
              style={{
                fontSize: "11px",
                color: "#475569",
                margin: "24px 0 0",
              }}
            >
              If this keeps happening, please contact support.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
