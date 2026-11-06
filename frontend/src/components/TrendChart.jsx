import { CartesianGrid, Line, LineChart, Scatter, ComposedChart, Tooltip, XAxis, YAxis, ErrorBar, Legend } from 'recharts';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import ChartCard from './ChartCard';
import { ErrorState, Loading } from './States';
import { SyntheticBadge } from './ui';
import { AXIS, COLORS, GRID, TOOLTIP_STYLE } from '../utils/palette';
import { fmtNum, fmtShortDate, titleCase } from '../utils/format';

/**
 * Observed series for one dataset/variable/sensor. Optional overlays:
 *   jobId   - highlight rows flagged by that anomaly/quality job
 *   recon   - reconstruction records [{timestamp, reconstructedValue, uncertainty}] drawn with interval bars
 */
export default function TrendChart({ datasetId, variable, sensor, jobId, recon, title, height = 300, onSensors }) {
  const { data, error, loading, reload } = useAsync(async () => {
    const { data: d } = await api.get(`/datasets/${datasetId}/series`, { params: { variable, sensor, jobId, limit: 2500 } });
    onSensors?.(d.sensors);
    return d;
  }, [datasetId, variable, sensor, jobId], !!datasetId && !!variable);

  if (loading) return <Loading label="Loading series…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const pts = data.points.map((p) => ({ ...p, ts: new Date(p.t).getTime() }));
  const flagged = pts.filter((p) => p.flagged && p.v !== null);
  const rec = (recon || []).filter((r) => r.reconstructedValue !== null && (!sensor || !r.sensorId || r.sensorId === data.sensor)).map((r) => {
    const iv = r.uncertainty?.interval;
    return { ts: new Date(r.timestamp).getTime(), est: r.reconstructedValue, err: iv ? [r.reconstructedValue - iv.low, iv.high - r.reconstructedValue] : 0 };
  });

  return (
    <ChartCard title={title || `${titleCase(variable)} over time`} subtitle={`Sensor ${data.sensor ?? 'n/a'} · ${data.totalPoints.toLocaleString()} observations${data.step > 1 ? ` (every ${data.step}th shown)` : ''}. Gaps = missing values.`}
      badge={data.isSynthetic ? <SyntheticBadge /> : null} height={height} empty={pts.length === 0} emptyText="No plottable observations. Check the column mapping.">
      <ComposedChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtShortDate} {...AXIS} />
        <YAxis {...AXIS} domain={['auto', 'auto']} tickFormatter={(v) => fmtNum(v, 1)} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => new Date(v).toLocaleString()} formatter={(v) => (Array.isArray(v) ? v.map((x) => fmtNum(x, 3)).join(' / ') : fmtNum(v, 3))} />
        <Legend />
        <Line type="monotone" dataKey="v" name="Observed" stroke={COLORS.primary} dot={false} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} />
        {flagged.length > 0 && <Scatter data={flagged} dataKey="v" name="Suspected anomaly" fill={COLORS.red} shape="circle" isAnimationActive={false} />}
        {rec.length > 0 && (
          <Scatter data={rec} dataKey="est" name="Reconstructed (±empirical interval)" fill={COLORS.amber} isAnimationActive={false}>
            <ErrorBar dataKey="err" direction="y" stroke={COLORS.amber} width={3} />
          </Scatter>
        )}
      </ComposedChart>
    </ChartCard>
  );
}

// re-export for tests / other pages that only need a plain line chart
export { LineChart };
