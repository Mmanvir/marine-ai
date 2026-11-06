import axios from 'axios';

const KEY = 'mt_token';
// Token is kept in localStorage (wrapped: it can throw in private windows). See docs/SECURITY.md for the trade-off.
export const tokenStore = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(t) { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 60000 });

api.interceptors.request.use((cfg) => {
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/register')) {
      tokenStore.clear();
      window.dispatchEvent(new Event('mt:unauthorized'));
    }
    return Promise.reject(err);
  }
);

/** Human-readable message from an axios error (includes validation details when present). */
export function errMsg(e) {
  const d = e?.response?.data?.error;
  if (d?.message) {
    const extra = Array.isArray(d.details) ? d.details.map((x) => (x.path ? `${x.path}: ${x.message}` : x.message || x)).join('; ') : '';
    return extra ? `${d.message} (${extra})` : d.message;
  }
  if (e?.code === 'ERR_NETWORK') return 'Cannot reach the server. Is the backend running?';
  return e?.message || 'Something went wrong';
}

/** Authenticated file download (auth is a header, so a plain <a href> cannot be used). */
export async function downloadFile(url, params, fallbackName) {
  const res = await api.get(url, { params, responseType: 'blob', timeout: 300000 });
  const cd = res.headers['content-disposition'] || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(res.data);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
