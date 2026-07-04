import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { RoleNav } from './RoleNav.js';

function renderNav(path = '/admin') {
  const router = createMemoryRouter([{ path: '/*', element: <RoleNav /> }], {
    initialEntries: [path],
  });
  render(<RouterProvider router={router} />);
}

describe('RoleNav', () => {
  it('links to home and every role', () => {
    renderNav();
    expect(screen.getByRole('link', { name: 'Jeopardy' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Host' })).toHaveAttribute('href', '/host');
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '/board');
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/play');
  });

  it('marks the current route as active', () => {
    renderNav('/host');
    expect(screen.getByRole('link', { name: 'Host' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Admin' })).not.toHaveAttribute('aria-current');
  });
});
