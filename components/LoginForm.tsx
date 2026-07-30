"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  GateStatusResponse,
  LoginFailureResponse,
  LoginSuccessResponse,
} from "@/lib/web-auth-types";

export type LoginFormProps = {
  nextPath?: string;
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 440,
  margin: "auto",
  padding: "28px 24px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 22,
  fontWeight: 600,
  color: "var(--text)",
};

const mutedStyle: React.CSSProperties = {
  margin: "0 0 16px",
  color: "var(--text-muted)",
  lineHeight: 1.5,
};

const codeBlockStyle: React.CSSProperties = {
  display: "block",
  margin: "0 0 12px",
  padding: "12px 14px",
  borderRadius: 8,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontFamily: "var(--font-mono-font, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  overflowX: "auto",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  marginTop: 12,
  color: "#dc2626",
  fontSize: 13,
  lineHeight: 1.4,
};

const warningStyle: React.CSSProperties = {
  margin: "0 0 16px",
  padding: "12px 14px",
  borderRadius: 8,
  background: "color-mix(in srgb, #f59e0b 14%, var(--bg))",
  border: "1px solid color-mix(in srgb, #f59e0b 45%, var(--border))",
  color: "var(--text)",
  lineHeight: 1.5,
};

const linkStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontWeight: 600,
  textDecoration: "none",
};

export function LoginForm({ nextPath }: LoginFormProps): React.ReactElement {
  const searchParams = useSearchParams();
  const resolvedNextPath = nextPath ?? searchParams.get("next") ?? "/";

  // Optimistic default: show password form immediately while status loads.
  const [status, setStatus] = useState<GateStatusResponse | null>({
    status: "enabled",
    configPath: "",
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch("/api/gate/status", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("status request failed");
        }
        const data = (await response.json()) as GateStatusResponse;
        if (!cancelled) {
          setStatus(data);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) {
          // Keep the password form available; surface a soft load error only on failure.
          setStatus({ status: "enabled", configPath: "" });
          setLoadError("Unable to load authentication status");
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/gate/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next: resolvedNextPath }),
      });
      const data = (await response.json()) as LoginSuccessResponse | LoginFailureResponse;

      if (!response.ok || !data.ok) {
        if (!data.ok) {
          if (response.status === 429 && typeof data.retryAfterSeconds === "number") {
            setError(`Too many attempts. Try again in ${data.retryAfterSeconds}s`);
          } else {
            setError(data.error);
          }
          if (response.status === 401) {
            setPassword("");
          }
        } else {
          setError("Sign-in failed");
        }
        return;
      }

      window.location.assign(data.next);
    } catch {
      setError("Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        overflowY: "auto",
        display: "flex",
        padding: "32px 16px",
        background: "var(--bg)",
        color: "var(--text)",
        boxSizing: "border-box",
      }}
    >
      <div style={cardStyle}>
        <h1 style={titleStyle}>Pi Web</h1>

        {status?.status === "enabled" ? (
          <>
            <p style={mutedStyle}>Enter the access password to continue.</p>
            {loadError ? <p style={errorStyle} role="alert">{loadError}</p> : null}
            <form onSubmit={handleSubmit} aria-busy={submitting}>
              <label htmlFor="pi-web-password" style={{ display: "block", marginBottom: 6, color: "var(--text-muted)" }}>
                Password
              </label>
              <input
                id="pi-web-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={submitting}
                onChange={(event) => setPassword(event.target.value)}
                style={inputStyle}
              />
              <button type="submit" disabled={submitting} aria-busy={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1, cursor: submitting ? "not-allowed" : "pointer" }}>
                {submitting ? "Signing in…" : "Sign in"}
              </button>
              {error ? <p style={errorStyle} role="alert">{error}</p> : null}
            </form>
          </>
        ) : status?.status === "unconfigured" ? (
          <>
            <p style={mutedStyle}>
              Access password is not configured yet. Write the config file or set environment variables, then restart the service.
            </p>
            <p style={mutedStyle}>Config file path:</p>
            <code style={codeBlockStyle}>{status.configPath}</code>
            <p style={mutedStyle}>Example JSON:</p>
            <code style={codeBlockStyle}>{`{
  "auth": {
    "password": "your-strong-password"
  }
}`}</code>
            <p style={mutedStyle}>Or environment variables:</p>
            <code style={codeBlockStyle}>{`export PI_WEB_PASSWORD="your-strong-password"
# or explicitly disable the gate (trusted environments only)
export PI_WEB_AUTH_DISABLED=true`}</code>
            <p style={mutedStyle}>Restrict config file permissions:</p>
            <code style={codeBlockStyle}>{`chmod 600 ${status.configPath}`}</code>
            <p style={mutedStyle}>Restart Pi Web after changing the configuration.</p>
          </>
        ) : status?.status === "error" ? (
          <>
            <p style={mutedStyle}>Authentication configuration cannot be read</p>
            <p style={mutedStyle}>Config file path:</p>
            <code style={codeBlockStyle}>{status.configPath}</code>
            <p style={mutedStyle}>
              Check that the config file is valid JSON, field types are correct, and `PI_WEB_AUTH_DISABLED` is only `true` or `false`. Restart the service after fixing it.
            </p>
            <p style={mutedStyle}>Detailed errors are written only to server logs and are not shown here.</p>
          </>
        ) : status?.status === "disabled" ? (
          <>
            <div style={warningStyle}>
              Authentication is disabled. The password gate is currently off. Config: {status.configPath}
            </div>
            <Link href="/" style={linkStyle}>Open Pi Web</Link>
          </>
        ) : (
          <>
            <p style={mutedStyle}>Enter the access password to continue.</p>
            {loadError ? <p style={errorStyle} role="alert">{loadError}</p> : null}
            <form onSubmit={handleSubmit} aria-busy={submitting}>
              <label htmlFor="pi-web-password" style={{ display: "block", marginBottom: 6, color: "var(--text-muted)" }}>
                Password
              </label>
              <input
                id="pi-web-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={submitting}
                onChange={(event) => setPassword(event.target.value)}
                style={inputStyle}
              />
              <button type="submit" disabled={submitting} aria-busy={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1, cursor: submitting ? "not-allowed" : "pointer" }}>
                {submitting ? "Signing in…" : "Sign in"}
              </button>
              {error ? <p style={errorStyle} role="alert">{error}</p> : null}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
