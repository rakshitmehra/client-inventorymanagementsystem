'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { api } from '@/lib/api';
import { dateTime, initials } from '@/lib/format';
import { Alert, Badge, Button, Field, Input, useToast } from '@/components/ui';

export default function ProfilePage() {
  const { user, isAdmin, signOut } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { run, loading } = useAction();

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function changePassword(event) {
    event.preventDefault();
    setError(null);
    setErrors({});
    try {
      const result = await run(() => api.post('/auth/change-password', form));
      toast.success(result.message);
      setForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    }
  }

  if (!user) return null;

  return (
    <Layout title="My Profile" subtitle="Your account details and access">
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <h3>Account</h3>
          </div>
          <div className="card-body">
            <div className="flex items-center gap-16 mb-16">
              <div className="avatar lg" style={{ width: 56, height: 56, fontSize: 20 }}>
                {initials(user.full_name)}
              </div>
              <div>
                <h3 style={{ fontSize: 17 }}>{user.full_name}</h3>
                <p className="muted small mt-4">
                  <span className="mono">{user.username}</span> · {user.email}
                </p>
                <div className="mt-8">
                  <Badge tone={isAdmin ? 'violet' : 'blue'}>{user.role_name}</Badge>
                </div>
              </div>
            </div>

            <dl className="kv">
              <dt>Phone</dt>
              <dd>{user.phone || '—'}</dd>
              <dt>Last sign-in</dt>
              <dd>{user.last_login_at ? dateTime(user.last_login_at) : 'This is your first'}</dd>
              <dt>Status</dt>
              <dd>
                <Badge tone={user.is_active ? 'green' : 'red'} dot>
                  {user.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </dd>
            </dl>

            <div className="divider" />

            <div className="stat-label mb-8">Access</div>
            {isAdmin ? (
              <Alert tone="info">
                As an administrator you can see and change every kitchen, the Main Inventory, all
                reports and the audit log.
              </Alert>
            ) : user.kitchens.length === 0 ? (
              <Alert tone="warn" title="No kitchen assigned">
                Ask an administrator to assign you to a kitchen before you can record production.
              </Alert>
            ) : (
              <>
                <p className="muted small mb-12">
                  You can only see the stock and activity of these kitchens:
                </p>
                <div className="flex col gap-8">
                  {user.kitchens.map((kitchen) => (
                    <div key={kitchen.id} className="flex items-center gap-8">
                      <Badge tone="brand">{kitchen.code}</Badge>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 550 }}>{kitchen.name}</div>
                        <div className="cell-sub">{kitchen.location || 'No location recorded'}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push(`/kitchens/${kitchen.id}/inventory`)}
                      >
                        Inventory
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="card-foot">
            <Button variant="ghost" onClick={() => signOut()}>
              Sign out of this device
            </Button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Change password</h3>
          </div>
          <form onSubmit={changePassword}>
            <div className="card-body">
              {error && !Object.keys(errors).length && (
                <div className="mb-16">
                  <Alert tone="error">{error.message}</Alert>
                </div>
              )}

              <Field label="Current password" required error={errors.current_password}>
                <Input
                  type="password"
                  value={form.current_password}
                  onChange={set('current_password')}
                  error={errors.current_password}
                  autoComplete="current-password"
                />
              </Field>

              <Field
                label="New password"
                required
                error={errors.new_password}
                hint="At least 8 characters"
              >
                <Input
                  type="password"
                  value={form.new_password}
                  onChange={set('new_password')}
                  error={errors.new_password}
                  autoComplete="new-password"
                />
              </Field>

              <Field label="Confirm new password" required error={errors.confirm_password}>
                <Input
                  type="password"
                  value={form.confirm_password}
                  onChange={set('confirm_password')}
                  error={errors.confirm_password}
                  autoComplete="new-password"
                />
              </Field>

              <p className="muted xs">
                Password changes are recorded in the audit log. You will stay signed in on this
                device.
              </p>
            </div>
            <div className="card-foot">
              <Button
                type="submit"
                variant="primary"
                loading={loading}
                disabled={!form.current_password || form.new_password.length < 8}
              >
                Update password
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
