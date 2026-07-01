import crypto from 'node:crypto';

export interface HostTokenPayload {
  role: 'host';
  iat: number;
}

const TOKEN_ROLE = 'host';

export function mintHostToken(): string {
  const secret = getTokenSecret();
  const payload: HostTokenPayload = { role: TOKEN_ROLE, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export function verifyHostToken(token: string): HostTokenPayload | null {
  const secret = getTokenSecret();
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) {
    return null;
  }

  const expectedSignature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (!('role' in parsed) || (parsed as { role: string }).role !== TOKEN_ROLE) {
      return null;
    }
    return parsed as HostTokenPayload;
  } catch {
    return null;
  }
}

function getTokenSecret(): string {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    throw new Error('TOKEN_SECRET is not configured');
  }
  return secret;
}
