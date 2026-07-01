import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LandingRoute } from './landing.js';

function renderLanding() {
  const router = createMemoryRouter([{ path: '/', element: <LandingRoute /> }], {
    initialEntries: ['/'],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('LandingRoute', () => {
  it('presents a clear entry point for each of the four surfaces', () => {
    renderLanding();

    const adminLink = screen.getByRole('link', { name: 'Admin' });
    const hostLink = screen.getByRole('link', { name: 'Host' });
    const boardLink = screen.getByRole('link', { name: 'Board' });
    const playLink = screen.getByRole('link', { name: 'Join' });

    expect(adminLink).toHaveAttribute('href', '/admin');
    expect(hostLink).toHaveAttribute('href', '/host');
    expect(boardLink).toHaveAttribute('href', '/board');
    expect(playLink).toHaveAttribute('href', '/play');
  });

  it('shows the app title and a brief description', () => {
    renderLanding();

    expect(screen.getByRole('heading', { name: /jeopardy tournament/i })).toBeInTheDocument();
    expect(screen.getByText(/choose a role to get started/i)).toBeInTheDocument();
  });
});
