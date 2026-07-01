import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasscodeGate } from './PasscodeGate.js';

const STORAGE_KEY = 'jeopardy-host-token';

function mockLoginThenVerify(token: string) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/auth/host') {
      return Promise.resolve(new Response(JSON.stringify({ token }), { status: 200 }));
    }
    if (url === '/api/auth/me') {
      return Promise.resolve(new Response(JSON.stringify({ role: 'host' }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockVerify(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PasscodeGate', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  it('shows a masked passcode prompt when no token is stored', () => {
    mockVerify(new Response(JSON.stringify({ role: 'host' }), { status: 200 }));
    render(
      <PasscodeGate>
        <p>Protected</p>
      </PasscodeGate>,
    );

    expect(screen.getByRole('heading', { name: 'Enter Host Passcode' })).toBeInTheDocument();
    const input = screen.getByLabelText('Passcode');
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('unlocks after submitting the correct passcode', async () => {
    const user = userEvent.setup();
    mockLoginThenVerify('valid-token');
    render(
      <PasscodeGate>
        <p>Protected</p>
      </PasscodeGate>,
    );

    await user.type(screen.getByLabelText('Passcode'), 'jeopardy');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(screen.getByText('Protected')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Lock host access' })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('valid-token');
  });

  it('shows an error for an incorrect passcode', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Incorrect passcode' }), { status: 401 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PasscodeGate>
        <p>Protected</p>
      </PasscodeGate>,
    );

    await user.type(screen.getByLabelText('Passcode'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(screen.getByText('Incorrect passcode')).toBeInTheDocument());
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('does not submit an empty passcode', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ token: 'x' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PasscodeGate>
        <p>Protected</p>
      </PasscodeGate>,
    );

    const button = screen.getByRole('button', { name: 'Unlock' });
    expect(button).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unlocks automatically when a valid token is stored', async () => {
    localStorage.setItem(STORAGE_KEY, 'stored-token');
    const fetchMock = mockVerify(new Response(JSON.stringify({ role: 'host' }), { status: 200 }));

    render(
      <PasscodeGate>
        <p>Protected</p>
      </PasscodeGate>,
    );

    await waitFor(() => expect(screen.getByText('Protected')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Lock host access' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer stored-token' },
      }),
    );
  });

  it('re-gates when the stored token is invalid', async () => {
    localStorage.setItem(STORAGE_KEY, 'bad-token');
    mockVerify(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));

    render(
      <PasscodeGate>
        <p>Protected</p>
      </PasscodeGate>,
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Enter Host Passcode' })).toBeInTheDocument(),
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('re-gates when the lock button is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'stored-token');
    mockVerify(new Response(JSON.stringify({ role: 'host' }), { status: 200 }));

    render(
      <PasscodeGate>
        <p>Protected</p>
      </PasscodeGate>,
    );

    await waitFor(() => expect(screen.getByText('Protected')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Lock host access' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Enter Host Passcode' })).toBeInTheDocument(),
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
