import { describe, expect, it } from 'vitest';
import { fmtBytes, fmtFrac, fmtNum, fmtPct, methodLabel, parseHeaderLine, suggestMapping, titleCase } from '../utils/format';

describe('formatters', () => {
  it('formats numbers and shows a dash for missing values', () => {
    expect(fmtNum(1234.5678, 2)).toMatch(/1,?234\.57/);
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtPct(12.345)).toBe('12.3%');
    expect(fmtFrac(0.9, 0)).toBe('90%');
    expect(fmtFrac(null)).toBe('—');
  });
  it('formats bytes', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
  });
  it('labels', () => {
    expect(titleCase('sea_surface_temperature')).toBe('Sea Surface Temperature');
    expect(methodLabel('mare')).toContain('MARE');
    expect(methodLabel('isolation_forest')).toBe('Isolation Forest');
  });
});

describe('csv header helpers', () => {
  it('parses quoted headers', () => {
    expect(parseHeaderLine('﻿time,"SST, C",station\n1,2,3')).toEqual(['time', 'SST, C', 'station']);
  });
  it('suggests a canonical mapping from aliases without reusing columns', () => {
    expect(suggestMapping(['Time', 'LAT', 'Lon', 'SST', 'station'])).toEqual({
      timestamp: 'Time', latitude: 'LAT', longitude: 'Lon', sea_surface_temperature: 'SST', sensor_id: 'station',
    });
    expect(suggestMapping(['foo', 'bar'])).toEqual({});
  });
});
