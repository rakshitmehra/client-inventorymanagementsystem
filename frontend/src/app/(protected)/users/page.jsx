'use client';

import { useState } from 'react';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { initials, relative } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  FilterBar,SearchInput,
  Select,
  useToast,
} from '@/components/ui';

export default function UsersPage() {
  return (
    <AdminOnly>
      <Users />
    </AdminOnly>
  );
}

function Users() {
  const toast = useToast();
  const { user: me } = useAuth();
  const { run, loading: busy } = useAction();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [toggling, setToggling] = useState(null);

  const path = `/users?include_inactive=${includeInactive}${role ? `&role=${role}` : ''}${
    search ? `&search=${encodeURIComponent(search)}` : ''
  }`;
  const { data, loading, error, reload } = useFetch(path);
  const roles = useFetch('/users/roles');
  const kitchens = useFetch('/kitchens?include_inactive=true');

  async function toggleStatus() {
    try {
      const result = await run(() =>
        api.patch(`/users/${toggling.id}/status`, { is_active: !toggling.is_active }),
      );
      toast.success(result.message);
      setToggling(null);
      reload();
    } catch (err) {
      toast.error(err.message);
      setToggling(null);
    }
  }

  return (
    <Layout
      title="Users & Roles"
      subtitle="Administrators see everything; kitchen managers see only their assigned kitchens"
      actions={
        <Button variant="primary" onClick={() => setEditing({})}>
          Add user
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <FilterBar
            more={
              <>
                <Select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="All roles"
                  options={(roles.data?.data ?? []).map((r) => ({ value: r.code, label: r.name }))}
                />
                <Select
                  value={String(includeInactive)}
                  onChange={(e) => setIncludeInactive(e.target.value === 'true')}
                  options={[
                    { value: 'true', label: 'Show all' },
                    { value: 'false', label: 'Active only' },
                  ]}
                />
              </>
            }
          >
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name, username or email…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={data?.data ?? []}
          columns={[
            {
              key: 'full_name',
              label: 'User',
              render: (r) => (
                <div className="flex items-center gap-12">
                  <div className="avatar">{initials(r.full_name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-title">
                      {r.full_name} {r.id === me.id && <Badge tone="brand">You</Badge>}
                    </div>
                    <div className="cell-sub">
                      <span className="mono">{r.username}</span> · {r.email}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'role_code',
              label: 'Role',
              render: (r) => (
                <Badge tone={r.role_code === 'ADMIN' ? 'violet' : 'blue'}>{r.role_name}</Badge>
              ),
            },
            {
              key: 'kitchens',
              label: 'Kitchens',
              render: (r) =>
                r.role_code === 'ADMIN' ? (
                  <span className="muted small">All kitchens</span>
                ) : r.kitchens.length === 0 ? (
                  <Badge tone="amber">Unassigned</Badge>
                ) : (
                  <div className="flex gap-4 wrap">
                    {r.kitchens.map((k) => (
                      <Badge key={k.id} tone="gray">
                        {k.name}
                      </Badge>
                    ))}
                  </div>
                ),
            },
            {
              key: 'phone',
              label: 'Phone',
              render: (r) => <span className="muted small">{r.phone || '—'}</span>,
            },
            {
              key: 'last_login_at',
              label: 'Last sign-in',
              render: (r) => (
                <span className="muted small nowrap">
                  {r.last_login_at ? relative(r.last_login_at) : 'Never'}
                </span>
              ),
            },
            {
              key: 'is_active',
              label: 'Status',
              render: (r) => (
                <Badge tone={r.is_active ? 'green' : 'gray'} dot>
                  {r.is_active ? 'Active' : 'Inactive'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <div className="flex gap-4 nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setResetting(r)}>
                    Reset password
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={r.id === me.id}
                    onClick={() => setToggling(r)}
                  >
                    {r.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="users"
              title="No users match"
              message="Add kitchen managers and give them access to the kitchens they run."
              action={
                <Button variant="primary" onClick={() => setEditing({})}>
                  Add a user
                </Button>
              }
            />
          }
        />
      </div>

      <UserForm
        user={editing}
        roles={roles.data?.data ?? []}
        kitchens={(kitchens.data?.data ?? []).filter((k) => k.is_active)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
        toast={toast}
      />

      <ResetPasswordForm
        user={resetting}
        onClose={() => setResetting(null)}
        onSaved={() => setResetting(null)}
        toast={toast}
      />

      <ConfirmDialog
        open={!!toggling}
        title={`${toggling?.is_active ? 'Deactivate' : 'Activate'} ${toggling?.full_name}?`}
        message={
          toggling?.is_active
            ? 'They will be unable to sign in again. Their history and kitchen assignments are kept.'
            : 'They will be able to sign in again with their existing password.'
        }
        confirmLabel={toggling?.is_active ? 'Deactivate' : 'Activate'}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={toggleStatus}
        onCancel={() => setToggling(null)}
      />
    </Layout>
  );
}

/* ------------------------------------------------------------------------- */
function UserForm({ user, roles, kitchens, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [seeded, setSeeded] = useState(false);

  if (user && !seeded) {
    setForm({
      username: user.username ?? '',
      email: user.email ?? '',
      full_name: user.full_name ?? '',
      phone: user.phone ?? '',
      role_id: user.role_id ?? roles.find((r) => r.code === 'KITCHEN_MANAGER')?.id ?? '',
      password: '',
      kitchen_ids: [],
    });
    setSeeded(true);
  }
  if (!user && seeded) setSeeded(false);

  const isNew = user && !user.id;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const selectedRole = roles.find((r) => r.id === Number(form.role_id));
  const isManagerRole = selectedRole?.code === 'KITCHEN_MANAGER';

  async function submit() {
    setError(null);
    setErrors({});
    const payload = {
      username: form.username,
      email: form.email,
      full_name: form.full_name,
      phone: form.phone || null,
      role_id: Number(form.role_id),
    };
    try {
      if (isNew) {
        await run(() =>
          api.post('/users', {
            ...payload,
            password: form.password,
            kitchen_ids: isManagerRole ? form.kitchen_ids : [],
          }),
        );
        toast.success(`${form.full_name} can now sign in`);
      } else {
        await run(() => api.put(`/users/${user.id}`, payload));
        toast.success(`${form.full_name} updated`);
      }
      onSaved();
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    }
  }

  const toggleKitchen = (id) =>
    setForm((f) => ({
      ...f,
      kitchen_ids: f.kitchen_ids.includes(id)
        ? f.kitchen_ids.filter((k) => k !== id)
        : [...f.kitchen_ids, id],
    }));

  return (
    <Modal
      open={!!user}
      size="wide"
      title={isNew ? 'Add a user' : `Edit ${user?.full_name}`}
      subtitle={isNew ? 'Create an account and set what it can reach' : user?.username}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            {isNew ? 'Create account' : 'Save changes'}
          </Button>
        </>
      }
    >
      {error && !Object.keys(errors).length && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <div className="form-row">
        <Field label="Full name" required error={errors.full_name}>
          <Input
            value={form.full_name ?? ''}
            onChange={set('full_name')}
            error={errors.full_name}
            placeholder="Rajesh Kumar"
            autoFocus
          />
        </Field>
        <Field
          label="Username"
          required
          error={errors.username}
          hint="Lowercase letters, numbers, dots and dashes"
        >
          <Input
            value={form.username ?? ''}
            onChange={set('username')}
            error={errors.username}
            placeholder="rajesh.kumar"
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="Email" required error={errors.email}>
          <Input
            value={form.email ?? ''}
            onChange={set('email')}
            error={errors.email}
            placeholder="rajesh@example.com"
          />
        </Field>
        <Field label="Phone" optional error={errors.phone}>
          <Input value={form.phone ?? ''} onChange={set('phone')} placeholder="+91 …" />
        </Field>
      </div>

      <div className="form-row">
        <Field label="Role" required error={errors.role_id}>
          <Select
            value={form.role_id ?? ''}
            onChange={set('role_id')}
            error={errors.role_id}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
        </Field>
        {isNew && (
          <Field
            label="Temporary password"
            required
            error={errors.password}
            hint="At least 8 characters — they can change it after signing in"
          >
            <Input
              type="text"
              value={form.password ?? ''}
              onChange={set('password')}
              error={errors.password}
              placeholder="Manager@123"
            />
          </Field>
        )}
      </div>

      {selectedRole && (
        <Alert tone="info">
          {selectedRole.code === 'ADMIN'
            ? 'Administrators can see and change every kitchen, the Main Inventory, all reports and the audit log.'
            : 'Kitchen managers only see the kitchens assigned to them. They cannot reach the Main Inventory or other kitchens.'}
        </Alert>
      )}

      {isNew && isManagerRole && (
        <div className="mt-16">
          <Field
            label="Assign to kitchens"
            optional
            hint="You can change this later from the kitchen page"
          >
            <div className="flex col gap-8">
              {kitchens.length === 0 && (
                <p className="muted small">No active kitchens to assign yet.</p>
              )}
              {kitchens.map((k) => (
                <Checkbox
                  key={k.id}
                  label={`${k.name} (${k.code})`}
                  checked={form.kitchen_ids?.includes(k.id) ?? false}
                  onChange={() => toggleKitchen(k.id)}
                />
              ))}
            </div>
          </Field>
        </div>
      )}

      {!isNew && user?.kitchens?.length > 0 && (
        <div className="mt-16">
          <Field label="Currently manages">
            <div className="flex gap-4 wrap">
              {user.kitchens.map((k) => (
                <Badge key={k.id} tone="gray">
                  {k.name}
                </Badge>
              ))}
            </div>
          </Field>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------------- */
function ResetPasswordForm({ user, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});

  async function submit() {
    setErrors({});
    try {
      const result = await run(() =>
        api.post(`/users/${user.id}/reset-password`, { new_password: password }),
      );
      toast.success(result.message);
      setPassword('');
      onSaved();
    } catch (err) {
      setErrors(err.details || { new_password: err.message });
    }
  }

  return (
    <Modal
      open={!!user}
      title={`Reset password for ${user?.full_name}`}
      subtitle="Share the new password with them securely"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={loading} disabled={password.length < 8}>
            Reset password
          </Button>
        </>
      }
    >
      <Field label="New password" required error={errors.new_password} hint="At least 8 characters">
        <Input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.new_password}
          placeholder="Enter a new password"
          autoFocus
        />
      </Field>
      <p className="muted small">
        The reset is recorded in the audit log. The user stays signed in on existing sessions until
        their token expires.
      </p>
    </Modal>
  );
}
