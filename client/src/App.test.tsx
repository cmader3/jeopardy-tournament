import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AdminRoute } from './routes/admin.js';
import { HostRoute } from './routes/host.js';
import { BoardRoute } from './routes/board.js';
import { PlayRoute } from './routes/play.js';
import { LandingRoute } from './routes/landing.js';

function renderRoute(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <LandingRoute /> },
      { path: '/admin', element: <AdminRoute /> },
      { path: '/host', element: <HostRoute /> },
      { path: '/board', element: <BoardRoute /> },
      { path: '/play', element: <PlayRoute /> },
    ],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
}

describe('App route stubs', () => {
  it.each([
    ['/admin', 'Enter Host Passcode'],
    ['/host', 'Enter Host Passcode'],
    ['/board', 'Board'],
    ['/play', 'Join Game'],
  ])('renders %s with its expected heading', (path, heading) => {
    renderRoute(path);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  });
});
