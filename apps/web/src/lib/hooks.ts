import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorText } from './api';

export interface AsyncState<T> {
  data?: T;
  error?: string;
  /** HTTP status of the failure, so pages can tell "not allowed" from "broken". */
  status?: number;
  loading: boolean;
  reload: () => void;
}

/** Runs `fn` on mount and whenever `deps` change; keeps the previous data on screen while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: string; status?: number; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    latest
      .current()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState({ loading: false, error: errorText(e), status: e instanceof ApiError ? e.status : undefined }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Wraps an async action with busy/error state for buttons and forms. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
