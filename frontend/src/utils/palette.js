// Categorical palette (ocean-oriented, distinguishable in light and dark). Never rely on colour alone: charts also label series.
export const COLORS = {
  primary: '#06b6d4',
  blue: '#3b82f6',
  amber: '#f59e0b',
  green: '#10b981',
  violet: '#a78bfa',
  red: '#ef4444',
  slate: '#64748b',
};
export const SERIES = [COLORS.primary, COLORS.blue, COLORS.amber, COLORS.green, COLORS.violet, COLORS.red];
export const METHOD_COLORS = { mare: COLORS.primary, linear: COLORS.blue, time: COLORS.green, rolling: COLORS.amber, iterative: COLORS.violet };
export const AXIS = { stroke: 'var(--muted)', fontSize: 12 };
export const GRID = 'var(--line)';
export const TOOLTIP_STYLE = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 };
