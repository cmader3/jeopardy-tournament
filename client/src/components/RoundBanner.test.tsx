import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoundBanner } from './RoundBanner.js';

describe('RoundBanner', () => {
  it.each([
    ['JEOPARDY', 'Jeopardy!'],
    ['DOUBLE_JEOPARDY', 'Double Jeopardy!'],
    ['FINAL', 'Final Jeopardy!'],
  ] as const)('renders %s as "%s"', (type, text) => {
    render(<RoundBanner roundType={type} />);
    expect(screen.getByTestId('round-banner')).toHaveTextContent(text);
  });
});
