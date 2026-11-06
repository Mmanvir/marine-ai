import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errMsg } from '../services/api';

const DONE = ['succeeded', 'failed'];

/** Poll one job until it finishes (back-off 1.2s -> 5s). Resolves with the final job. */
export function waitForJob(jobId, onUpdate) {
  return new Promise((resolve, reject) => {
    let delay = 1200;
    const tick = async () => {
      try {
        const { data } = await api.get(`/analysis/jobs/${jobId}`);
        onUpdate?.(data.job);
        if (DONE.includes(data.job.status)) return resolve(data.job);
        delay = Math.min(delay * 1.3, 5000);
        setTimeout(tick, delay);
      } catch (e) {
        reject(e);
      }
    };
    setTimeout(tick, delay);
  });
}

/** Start an analysis of one type and follow it. `onDone(job)` fires when it succeeds or fails. */
export function useAnalysis(type, onDone) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const start = useCallback(async (datasetId, params = {}) => {
    setError(null);
    setStarting(true);
    try {
      const { data } = await api.post(`/analysis/${datasetId}/${type}`, params);
      if (!alive.current) return;
      setJob(data.job);
      const final = await waitForJob(data.job._id, (j) => alive.current && setJob(j));
      if (alive.current) doneRef.current?.(final);
    } catch (e) {
      if (alive.current) setError(errMsg(e));
    } finally {
      if (alive.current) setStarting(false);
    }
  }, [type]);

  const running = starting || (job && !DONE.includes(job.status));
  return { job, error, start, running: !!running, reset: () => { setJob(null); setError(null); } };
}
