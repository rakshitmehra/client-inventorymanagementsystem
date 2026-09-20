'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Field, Input } from '@/components/ui';
import { Icon } from '@/components/Icon';

const DEMO_ACCOUNTS = [
  { role: 'Administrator', username: 'admin', password: 'Admin@123', note: 'All kitchens' },
  { role: 'Kitchen Manager', username: 'rajesh.kumar', password: 'Manager@123', note: 'Central Production' },
  { role: 'Kitchen Manager', username: 'meera.nair', password: 'Manager@123', note: 'Koregaon Park' },
  { role: 'Kitchen Manager', username: 'arjun.deshpande', password: 'Manager@123', note: 'Hinjewadi' },
];

/**
 * The one-tap sign-in shortcuts.
 *
 * On by default, including in production, so the deployment can be tested the
 * moment it goes live without anyone having to remember four passwords. It is
 * a switch rather than a code change: set NEXT_PUBLIC_SHOW_DEMO_LOGINS=false in
 * the Vercel project and redeploy to take it away, which is worth doing before
 * this holds anyone's real stock, because these buttons put four working
 * passwords on a public page.
 */
const SHOW_DEMO_LOGINS = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS !== 'false';

export default function LoginPage() {
  const { signIn, user, ready } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // Already signed in? Skip straight through.
  useEffect(() => {
    if (ready && user) router.replace('/dashboard');
  }, [ready, user, router]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      await signIn(form.username, form.password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.details || {});
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="flex items-center gap-12">
          <div className="sidebar-logo">
            <Icon name="brand" size={26} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>KitchenStock</div>
            <div style={{ fontSize: 'var(--text-sm)', opacity: 0.85 }}>
              Kitchen stock, made simple
            </div>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <h1>
            One main store.
            <br />
            Every kitchen accounted for.
          </h1>
          <p>
            Know exactly what you have, where it is, and what each batch used — without keeping a
            single paper register.
          </p>

          <div className="login-features">
            <div className="login-feature">
              <span className="login-feature-icon" aria-hidden="true">
                <Icon name="box" size={22} />
              </span>
              <span>One main store, plus a separate store for each kitchen</span>
            </div>
            <div className="login-feature">
              <span className="login-feature-icon" aria-hidden="true">
                <Icon name="cooking" size={22} />
              </span>
              <span>Record what you cook and we take the ingredients off for you</span>
            </div>
            <div className="login-feature">
              <span className="login-feature-icon" aria-hidden="true">
                <Icon name="clock" size={22} />
              </span>
              <span>A full history of everything received, sent, used and wasted</span>
            </div>
            <div className="login-feature">
              <span className="login-feature-icon" aria-hidden="true">
                <Icon name="printer" size={22} />
              </span>
              <span>Printable slips for every kitchen delivery</span>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 'var(--text-sm)', opacity: 0.75, position: 'relative' }}>
          Golden Crust Bakery &amp; Kitchens
        </div>
      </div>

      <div className="login-form-side">
        <div className="login-box">
          <h2>Sign in</h2>
          <p>Enter the username and password you were given.</p>

          {error && (
            <div className="mb-16">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          <form onSubmit={submit}>
            <Field label="Username or email" required error={fieldErrors.username}>
              <Input
                value={form.username}
                onChange={set('username')}
                placeholder="admin"
                autoComplete="username"
                autoFocus
                error={fieldErrors.username}
              />
            </Field>

            <Field label="Password" required error={fieldErrors.password}>
              <Input
                type="password"
                value={form.password}
                onChange={set('password')}
                placeholder="••••••••"
                autoComplete="current-password"
                error={fieldErrors.password}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="btn-block mt-8"
              loading={loading}
              disabled={!form.username || !form.password}
            >
              Sign in
            </Button>
          </form>

          {SHOW_DEMO_LOGINS && (
          <div className="demo-accounts">
            <h4>Try it — tap a name to fill the form</h4>
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.username}
                type="button"
                className="demo-account"
                onClick={() => {
                  setForm({ username: account.username, password: account.password });
                  setError(null);
                }}
              >
                <span style={{ fontWeight: 600 }}>{account.role}</span>
                <span className="muted">· {account.note}</span>
                <span className="mono">{account.username}</span>
              </button>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
