import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, post, setUnauthenticatedHandler } from '../lib/api';
import type { Me } from '../lib/types';

/** `signedOut` marks a deliberate sign-out, so the next sign-in starts at Home instead of resuming the last person's page. */
type State = { status: 'loading' } | { status: 'anon'; signedOut?: boolean } | { status: 'authed'; me: Me };

interface AuthApi {
  state: State;
  me: Me | null;
  login(loginId: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** True when the user holds `permission` in at least one scope. Display only: the API enforces scope. */
  can(permission: string): boolean;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    setUnauthenticatedHandler(() => setState({ status: 'anon' }));
    get<Me>('/me')
      .then((me) => setState({ status: 'authed', me }))
      .catch(() => setState({ status: 'anon' }));
  }, []);

  const login = useCallback(async (loginId: string, password: string) => {
    await post('/auth/login', { loginId, password });
    setState({ status: 'authed', me: await get<Me>('/me') });
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setState({ status: 'anon', signedOut: true });
    }
  }, []);

  const value = useMemo<AuthApi>(() => {
    const me = state.status === 'authed' ? state.me : null;
    return { state, me, login, logout, can: (p) => !!me?.permissions.includes(p) };
  }, [state, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** For screens that only render when signed in. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('useMe outside an authenticated route');
  return me;
}
