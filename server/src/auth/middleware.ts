import type { Request, RequestHandler } from 'express';
import { verifyHostToken, type HostTokenPayload } from './token.js';

export const requireHost: RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = verifyHostToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  (req as Request & { hostToken: HostTokenPayload }).hostToken = payload;
  next();
};
