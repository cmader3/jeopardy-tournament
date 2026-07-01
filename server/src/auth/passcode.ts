import crypto from 'node:crypto';

export function constantTimeCompare(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();

  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}
