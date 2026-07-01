import crypto from 'node:crypto';

export function generateReconnectToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}
