import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from '../services/api';

const sameDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * Run an async function when deps change. Returns {data, error, loading, reload}. Skips if `enabled` is false.
 *
 * The state remembers which deps produced it. On the render right after deps change (before the effect has
 * started the new request) the state is "stale", and we report loading=true instead of {loading:false, data:null}.
 * Without this, pages that read `data.x` once loading is false crashed on that in-between render.
 */
export function useAsync(fn, deps = [], enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [tick, setTick] = useState(0);
  const key = [...deps, enabled, tick];
  const [state, setState] = useState({ data: null, error: null, loading: enabled, key: null });

  useEffect(() => {
    if (!enabled) { setState({ data: null, error: null, loading: false, key }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => fnRef.current())
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false, key }); })
      .catch((e) => { if (!cancelled) setState({ data: null, error: errMsg(e), loading: false, key }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, key);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const stale = !sameDeps(state.key, key);
  if (!enabled) return { data: null, error: null, loading: false, reload };
  if (stale) return { data: null, error: null, loading: true, reload };
  return { data: state.data, error: state.error, loading: state.loading, reload };
}
