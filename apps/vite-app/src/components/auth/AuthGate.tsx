import React, { useEffect, useState, type ReactNode } from "react";
import { beginLogin, initializeAuth, subscribeAuth, type AuthState } from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeAuth((next) => active && setState(next));
    void initializeAuth()
      .then((next) => active && setState(next))
      .catch(() => active && setError(true));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (state === "authenticated") return children;

  const text = zhCN.auth;
  return (
    <main className="bg-bg flex min-h-screen items-center justify-center px-6">
      <section className="border-border-default bg-surface w-full max-w-sm rounded-2xl border p-8 text-center shadow-sm">
        <h1 className="text-text-default text-2xl font-bold">{text.title}</h1>
        <p className="text-text-muted mt-3 text-sm">
          {error
            ? text.callbackError
            : state === "misconfigured"
              ? text.misconfigured
              : state === "loading"
                ? text.loading
                : text.loginRequired}
        </p>
        {(state === "anonymous" || error) && (
          <button
            className="bg-accent text-accent-contrast hover:bg-accent-hover mt-6 w-full rounded-lg px-4 py-2.5 font-medium"
            onClick={() => void beginLogin().catch(() => setError(true))}
          >
            {error ? text.retryLogin : text.login}
          </button>
        )}
      </section>
    </main>
  );
}
