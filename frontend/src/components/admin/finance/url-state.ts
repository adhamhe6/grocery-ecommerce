"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * Filter state that starts from the URL (so `/admin/payments?state=FAILED` works from the dashboard) and is mirrored back
 * with `history.replaceState` — no server round-trip per keystroke, and reloading or sharing the link keeps the filters.
 * Values equal to their default (or empty) are left out of the URL. Only call inside a <Suspense> boundary.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const search = useSearchParams();
  const defaultsRef = React.useRef(defaults);
  const [state, setState] = React.useState<T>(() => {
    const initial: Record<string, string> = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = search.get(key);
      if (value !== null) initial[key] = value;
    }
    return initial as T;
  });
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    const params = new URLSearchParams(window.location.search);
    for (const key of Object.keys(defaultsRef.current)) {
      const value = state[key];
      if (!value || value === defaultsRef.current[key]) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [state]);
  const update = React.useCallback((patch: Partial<T>) => setState((prev) => ({ ...prev, ...patch })), []);
  return [state, update];
}
