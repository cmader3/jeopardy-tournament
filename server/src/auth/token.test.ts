import { describe, expect, it } from 'vitest';
import { mintHostToken, verifyHostToken } from './token.js';

describe('host token', () => {
  it('mints a token that verifies successfully', () => {
    const token = mintHostToken();
    const payload = verifyHostToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.role).toBe('host');
    expect(payload!.iat).toBeGreaterThan(0);
  });

  it('rejects a tampered signature', () => {
    const token = mintHostToken();
    const tampered = token.slice(0, -1) + 'X';
    expect(verifyHostToken(tampered)).toBeNull();
  });

  it('rejects a token with a tampered payload', () => {
    const token = mintHostToken();
    const [payloadB64, signature] = token.split('.');
    const tamperedPayload = Buffer.from(payloadB64, 'base64url').toString('utf8').replace('host', 'board');
    const tamperedB64 = Buffer.from(tamperedPayload).toString('base64url');
    const tampered = `${tamperedB64}.${signature}`;
    expect(verifyHostToken(tampered)).toBeNull();
  });

  it('rejects a token with a missing role', () => {
    const payloadB64 = Buffer.from(JSON.stringify({ iat: 1 })).toString('base64url');
    const token = `${payloadB64}.invalidsig`;
    expect(verifyHostToken(token)).toBeNull();
  });

  it('rejects malformed token strings', () => {
    expect(verifyHostToken('')).toBeNull();
    expect(verifyHostToken('only-one-part')).toBeNull();
    expect(verifyHostToken('a.b.c')).toBeNull();
  });
});
