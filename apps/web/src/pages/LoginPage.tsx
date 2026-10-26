import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox } from '../components/ui';
import { errorText } from '../lib/api';

export function LoginPage() {
  const { state, login } = useAuth();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (state.status === 'authed') return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(loginId.trim(), password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-700 text-xs font-bold tracking-tight text-white">MMF</span>
          <div className="leading-tight">
            <div className="text-base font-semibold text-slate-900">Performance Portal</div>
            <div className="text-xs text-slate-500">MM Forgings Ltd</div>
          </div>
        </div>
        <form onSubmit={submit} className="card card-pad space-y-4" aria-label="Sign in">
          <h1 className="text-lg font-semibold">Sign in</h1>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div>
            <label className="label" htmlFor="loginId">
              Employee code
            </label>
            <input id="loginId" className="input" autoComplete="username" autoFocus value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="e.g. E0101" required />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary w-full" disabled={busy || !loginId || !password}>
            <LogIn size={15} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted">What you can see and do depends on your role and the plant or department it is scoped to.</p>
        </form>
      </div>
    </div>
  );
}
