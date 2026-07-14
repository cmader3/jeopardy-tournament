// Formats a score or wager as a dollar amount for display. Negative values use
// a leading minus before the dollar sign (e.g., -$400); zero renders as $0.
export function formatScore(value: number): string {
  const amount = Number.isFinite(value) ? Math.trunc(value) : 0;
  return amount < 0 ? `-$${Math.abs(amount)}` : `$${amount}`;
}
