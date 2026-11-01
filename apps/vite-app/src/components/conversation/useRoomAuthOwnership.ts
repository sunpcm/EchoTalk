import { useCallback, useEffect, useRef, useState } from "react";
import {
  arePrincipalsEqual,
  getAuthRevision,
  getAuthSnapshot,
  subscribeAuthSnapshot,
} from "@/lib/auth";
import type { AuthPrincipal, AuthSnapshot } from "@/lib/auth";

interface BoundRoomAuth {
  readonly principal: AuthPrincipal | null;
  readonly revision: number | null;
}

export interface RoomAuthOwnership {
  readonly boundPrincipal: AuthPrincipal | null;
  readonly authorizedRevision: number | null;
  readonly isCurrent: () => boolean;
  readonly isCurrentPrincipal: () => boolean;
  readonly isCurrentRevision: (revision: number | null) => boolean;
}

function bindRoomAuth(): BoundRoomAuth {
  const snapshot = getAuthSnapshot();
  const principal = snapshot.state === "authenticated" ? snapshot.principal : null;
  return {
    principal,
    revision: principal ? getAuthRevision() : null,
  };
}

/**
 * Keeps one Room bound to its initial principal while allowing verified same-principal
 * notifications to advance the revision used by newly captured callbacks.
 */
export function useRoomAuthOwnership(): RoomAuthOwnership {
  const boundAuthRef = useRef<BoundRoomAuth | null>(null);
  const boundAuth = boundAuthRef.current ?? bindRoomAuth();
  boundAuthRef.current = boundAuth;

  const authorizedRevisionRef = useRef(boundAuth.revision);
  const [authorizedRevision, setAuthorizedRevision] = useState(boundAuth.revision);
  const isMountedRef = useRef(true);

  const isCurrentPrincipal = useCallback((): boolean => {
    if (!isMountedRef.current || !boundAuth.principal) {
      return false;
    }
    const snapshot = getAuthSnapshot();
    return (
      snapshot.state === "authenticated" &&
      arePrincipalsEqual(snapshot.principal, boundAuth.principal)
    );
  }, [boundAuth.principal]);

  const isCurrentRevision = useCallback(
    (revision: number | null): boolean =>
      revision !== null &&
      authorizedRevisionRef.current === revision &&
      getAuthRevision() === revision &&
      isCurrentPrincipal(),
    [isCurrentPrincipal],
  );

  const isCurrent = useCallback(
    (): boolean => isCurrentRevision(authorizedRevisionRef.current),
    [isCurrentRevision],
  );

  useEffect(() => {
    isMountedRef.current = true;
    let isActive = true;

    const adoptSnapshot = (snapshot: AuthSnapshot): void => {
      if (!isActive) return;
      const nextRevision =
        snapshot.state === "authenticated" &&
        snapshot.principal &&
        boundAuth.principal &&
        arePrincipalsEqual(snapshot.principal, boundAuth.principal)
          ? getAuthRevision()
          : null;

      authorizedRevisionRef.current = nextRevision;
      setAuthorizedRevision((current) => (current === nextRevision ? current : nextRevision));
    };

    // Subscribe before reading so a same-principal event cannot fall into a gap.
    const unsubscribe = subscribeAuthSnapshot(adoptSnapshot);
    adoptSnapshot(getAuthSnapshot());

    return () => {
      isActive = false;
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [boundAuth.principal]);

  return {
    boundPrincipal: boundAuth.principal,
    authorizedRevision,
    isCurrent,
    isCurrentPrincipal,
    isCurrentRevision,
  };
}
