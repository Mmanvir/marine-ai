import { useState } from 'react';
import { Database, HardDrive, Layers, Users } from 'lucide-react';
import { api, errMsg } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../hooks/AuthContext';
import DataTable from '../components/DataTable';
import { ErrorState, Loading } from '../components/States';
import { MetricCard, Notice, PageHeader, StatusBadge } from '../components/ui';
import { fmtBytes, fmtDate, fmtNum, titleCase } from '../utils/format';

export default function AdminDashboard() {
  const { user: me } = useAuth();
  const stats = useAsync(async () => (await api.get('/admin/stats')).data, []);
  const users = useAsync(async () => (await api.get('/admin/users')).data.users, []);
  const [err, setErr] = useState('');

  const patch = async (u, body) => {
    setErr('');
    try { await api.patch(`/admin/users/${u._id}`, body); users.reload(); stats.reload(); } catch (e) { setErr(errMsg(e)); }
  };

  if (stats.loading && !stats.data) return <Loading />;
  if (stats.error) return <ErrorState message={stats.error} onRetry={stats.reload} />;
  const s = stats.data;

  return (
    <>
      <PageHeader title="Administration" subtitle="System-wide counts and user management. Administrators cannot read other users' datasets; ownership is enforced for everyone." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Users" value={fmtNum(s.users, 0)} icon={Users} hint={Object.entries(s.usersByRole).map(([r, n]) => `${n} ${r}`).join(' · ')} />
        <MetricCard label="Datasets" value={fmtNum(s.datasets, 0)} icon={Database} />
        <MetricCard label="Observations stored" value={fmtNum(s.totalRows, 0)} icon={Layers} />
        <MetricCard label="Upload storage" value={fmtBytes(s.storageBytes)} icon={HardDrive} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card" aria-label="Services and jobs">
          <h2 className="mb-2 text-sm font-semibold">Services</h2>
          <ul className="text-sm">
            <li>Database: <StatusBadge tone={s.services.database === 'up' ? 'success' : 'danger'}>{s.services.database}</StatusBadge></li>
            <li className="mt-1">ML service: <StatusBadge tone={s.services.ml.status === 'up' ? 'success' : 'danger'}>{s.services.ml.status}</StatusBadge></li>
          </ul>
          <h2 className="mb-2 mt-4 text-sm font-semibold">Jobs by status</h2>
          <div className="flex flex-wrap gap-2">{Object.entries(s.jobsByStatus).map(([k, n]) => <span key={k} className="flex items-center gap-1 text-sm"><StatusBadge value={k} /> {n}</span>)}{!Object.keys(s.jobsByStatus).length && <span className="text-sm text-muted">No jobs yet.</span>}</div>
        </section>
        <section className="card" aria-label="Recent failures">
          <h2 className="mb-2 text-sm font-semibold">Recent failed jobs</h2>
          <DataTable caption="Failed jobs" rows={s.recentFailures} rowKey={(j) => j._id} empty="No failures. 🎉" columns={[
            { key: 't', label: 'Type', render: (j) => titleCase(j.type) }, { key: 'o', label: 'User', render: (j) => j.owner?.email }, { key: 'e', label: 'Error', render: (j) => <span className="text-xs">{j.error}</span> }, { key: 'at', label: 'When', render: (j) => fmtDate(j.createdAt) },
          ]} />
        </section>
      </div>
      <section className="card mt-6" aria-label="User management">
        <h2 className="mb-3 text-sm font-semibold">Users</h2>
        {err && <div className="mb-2"><Notice tone="danger">{err}</Notice></div>}
        {users.loading && !users.data ? <Loading /> : users.error ? <ErrorState message={users.error} onRetry={users.reload} /> : (
          <DataTable caption="Users" rows={users.data} rowKey={(u) => u._id} columns={[
            { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role', render: (u) => <StatusBadge tone={u.role === 'admin' ? 'accent' : 'neutral'}>{u.role}</StatusBadge> },
            { key: 'active', label: 'Status', render: (u) => <StatusBadge tone={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'active' : 'disabled'}</StatusBadge> },
            { key: 'ds', label: 'Datasets', render: (u) => u.datasetCount }, { key: 'last', label: 'Last login', render: (u) => fmtDate(u.lastLoginAt) },
            { key: 'act', label: 'Actions', render: (u) => (u._id === me._id ? <span className="text-xs text-muted">you</span> : (
              <div className="flex gap-1">
                <button className="btn-secondary px-2 py-1 text-xs" onClick={() => patch(u, { role: u.role === 'admin' ? 'researcher' : 'admin' })}>{u.role === 'admin' ? 'Make researcher' : 'Make admin'}</button>
                <button className="btn-secondary px-2 py-1 text-xs" onClick={() => patch(u, { isActive: !u.isActive })}>{u.isActive ? 'Disable' : 'Enable'}</button>
              </div>)) },
          ]} />)}
      </section>
    </>
  );
}
