import { Card, Chip, Empty, ErrorBox, Loading, PageHeader, TableWrap } from '../components/ui';
import { get } from '../lib/api';
import { useAsync } from '../lib/hooks';
import type { AdminUser } from '../lib/types';

/** Identity fields only: the Super Admin never sees scores or pay (doc 04 §3). */
export function AdminUsersPage() {
  const users = useAsync(() => get<{ users: AdminUser[] }>('/admin/users'), []);
  return (
    <>
      <PageHeader title="Users" subtitle="Accounts and sign-in mode. Role grants are made through the API; scores and pay are never shown here." />
      <Card pad={false}>
        {users.loading && !users.data ? (
          <Loading />
        ) : users.error ? (
          <div className="p-4">
            <ErrorBox onRetry={users.reload}>{users.error}</ErrorBox>
          </div>
        ) : !users.data?.users.length ? (
          <Empty title="No users" />
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Login</th>
                  <th className="th">Name</th>
                  <th className="th">Mobile</th>
                  <th className="th">Sign-in</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.data.users.map((u) => (
                  <tr key={u.id} className="tr-hover">
                    <td className="td font-mono text-xs">{u.loginId}</td>
                    <td className="td font-medium text-slate-900">{u.fullName}</td>
                    <td className="td">{u.mobile ?? '—'}</td>
                    <td className="td">{u.authMode === 'OTP_ONLY' ? 'OTP only' : 'Password'}</td>
                    <td className="td">
                      <Chip tone={u.status === 'ACTIVE' ? 'green' : 'slate'}>{u.status.toLowerCase()}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
