import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBadge, SyntheticBadge, MetricCard } from '../components/ui';
import DataTable from '../components/DataTable';
import { EmptyState, ErrorState } from '../components/States';
import FileUploader from '../components/FileUploader';

describe('ui components', () => {
  it('status badge always shows text, not only colour', () => {
    render(<StatusBadge value="manually_reviewed" />);
    expect(screen.getByText('manually reviewed')).toBeInTheDocument();
  });
  it('synthetic badge is labelled', () => {
    render(<SyntheticBadge />);
    expect(screen.getByText(/SYNTHETIC/)).toBeInTheDocument();
  });
  it('metric card exposes label and value', () => {
    render(<MetricCard label="Datasets" value="3" />);
    expect(screen.getByRole('group', { name: 'Datasets' })).toHaveTextContent('3');
  });
  it('empty and error states', async () => {
    const retry = vi.fn();
    render(<><EmptyState title="Nothing here">hint</EmptyState><ErrorState message="boom" onRetry={retry} /></>);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('DataTable', () => {
  const cols = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', render: (r) => `b-${r.b}` }];
  it('renders rows and an empty message', () => {
    const { rerender } = render(<DataTable columns={cols} rows={[{ a: 1, b: 2 }]} />);
    expect(screen.getByText('b-2')).toBeInTheDocument();
    rerender(<DataTable columns={cols} rows={[]} empty="No rows" />);
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });
  it('paginates', async () => {
    const onPage = vi.fn();
    render(<DataTable columns={cols} rows={[{ a: 1, b: 1 }]} pagination={{ page: 1, limit: 10, total: 35, onPage }} />);
    expect(screen.getByText(/Page 1 of 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('FileUploader validation', () => {
  it('rejects non-csv files and accepts csv', async () => {
    const onFile = vi.fn();
    const onError = vi.fn();
    render(<FileUploader file={null} onFile={onFile} onError={onError} />);
    const input = screen.getByTestId('csv-input');
    await userEvent.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
    expect(onError).toHaveBeenCalledWith('Only .csv files are supported.');
    expect(onFile).not.toHaveBeenCalled();
    await userEvent.upload(input, new File(['a,b\n1,2'], 'data.csv', { type: 'text/csv' }));
    expect(onFile).toHaveBeenCalled();
  });
});
