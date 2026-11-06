import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadFile, errMsg } from '../services/api';

export default function ExportButton({ url, params, filename, label = 'Export CSV', disabled }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await downloadFile(url, params, filename); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-col">
      <button type="button" className="btn-secondary" onClick={go} disabled={disabled || busy}><Download size={16} aria-hidden="true" /> {busy ? 'Preparing…' : label}</button>
      {err && <span role="alert" className="mt-1 text-xs text-red-600">{err}</span>}
    </span>
  );
}
