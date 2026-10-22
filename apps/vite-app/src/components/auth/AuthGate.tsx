import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  beginLogin,
  initializeAuthSnapshot,
  subscribeAuthSnapshot,
  arePrincipalsEqual,
  type AuthPrincipal,
  type AuthSnapshot,
} from "@/lib/auth";
import { clearUserSessionData } from "@/lib/user-state";
import { zhCN } from "@/i18n/zh-CN";

export function AuthGate({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({ state: "loading", principal: null });
  const [error, setError] = useState(false);
  const [accountGen, setAccountGen] = useState(0);

  const activePrincipalRef = useRef<AuthPrincipal | null>(null);

  useEffect(() => {
    let active = true;

    const handleSnapshot = (next: AuthSnapshot) => {
      if (!active) return;

      const prevPrincipal = activePrincipalRef.current;
      const nextPrincipal = next.principal;

      if (next.state === "authenticated" && nextPrincipal) {
        if (!arePrincipalsEqual(prevPrincipal, nextPrincipal)) {
          // 不同 principal 切换（或初次从不同身份切入）
          if (prevPrincipal !== null) {
            clearUserSessionData();
            setAccountGen((g) => g + 1);
          }
          activePrincipalRef.current = nextPrincipal;
        }
        setError(false);
      } else {
        // 未认证、退出或失效
        if (prevPrincipal !== null) {
          clearUserSessionData();
          activePrincipalRef.current = null;
        }
      }

      setSnapshot(next);
    };

    const unsubscribe = subscribeAuthSnapshot(handleSnapshot);

    void initializeAuthSnapshot()
      .then((initSnap) => {
        if (active) {
          handleSnapshot(initSnap);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          clearUserSessionData();
          activePrincipalRef.current = null;
        }
      });

    return () => {
      active = false;
      unsubscribe();
      // Gate 真正卸载时同步清理
      clearUserSessionData();
    };
  }, []);

  if (snapshot.state === "authenticated" && snapshot.principal) {
    return <React.Fragment key={accountGen}>{children}</React.Fragment>;
  }

  const text = zhCN.auth;
  const isMisconfigured = snapshot.state === "misconfigured";
  const isLoading = snapshot.state === "loading";
  const isAnonymous = snapshot.state === "anonymous";

  return (
    <main className="bg-bg flex min-h-screen items-center justify-center px-6">
      <section className="border-border-default bg-surface w-full max-w-sm rounded-2xl border p-8 text-center shadow-sm">
        <h1 className="text-text-default text-2xl font-bold">{text.title}</h1>
        <p className="text-text-muted mt-3 text-sm">
          {error
            ? text.callbackError
            : isMisconfigured
              ? text.misconfigured
              : isLoading
                ? text.loading
                : text.loginRequired}
        </p>
        {(isAnonymous || error) && (
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
