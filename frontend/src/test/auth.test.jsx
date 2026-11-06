import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../services/api', () => {
  const store = { t: null };
  return {
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
    tokenStore: { get: () => store.t, set: (t) => { store.t = t; }, clear: () => { store.t = null; } },
    errMsg: (e) => e?.response?.data?.error?.message || e?.message,
    downloadFile: vi.fn(),
  };
});

import { api, tokenStore } from '../services/api';
import { AuthProvider } from '../hooks/AuthContext';
import { ProtectedRoute } from '../App';
import Login from '../pages/Login';

const tree = (start) => (
  <MemoryRouter initialEntries={[start]}>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/app" element={<ProtectedRoute><div>secret dashboard</div></ProtectedRoute>} />
      </Routes>
    </AuthProvider>
  </MemoryRouter>
);

beforeEach(() => { tokenStore.clear(); vi.clearAllMocks(); });

describe('auth flow', () => {
  it('redirects anonymous users from a protected route to login', async () => {
    render(tree('/app'));
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('validates empty form before calling the API', async () => {
    render(tree('/login'));
    await userEvent.click(screen.getByRole('button', { name: /^log in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your email and password/i);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the server error for bad credentials', async () => {
    api.post.mockRejectedValueOnce({ response: { data: { error: { message: 'Invalid email or password' } } } });
    render(tree('/login'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass1');
    await userEvent.click(screen.getByRole('button', { name: /^log in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('logs in, stores the token and reaches the protected page', async () => {
    api.post.mockResolvedValueOnce({ data: { token: 'tok', user: { _id: '1', name: 'Ann', role: 'researcher' } } });
    render(tree('/login'));
    await userEvent.type(screen.getByLabelText('Email'), 'ann@lab.org');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse9');
    await userEvent.click(screen.getByRole('button', { name: /^log in$/i }));
    await waitFor(() => expect(screen.getByText('secret dashboard')).toBeInTheDocument());
    expect(tokenStore.get()).toBe('tok');
  });
});
