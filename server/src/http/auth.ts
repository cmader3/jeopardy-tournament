import { Router } from 'express';
import { z } from 'zod';
import { constantTimeCompare } from '../auth/passcode.js';
import { mintHostToken } from '../auth/token.js';
import { requireHost } from '../auth/middleware.js';

const loginBodySchema = z.object({
  passcode: z.string().min(1, 'Passcode is required'),
});

export const authRouter = Router();

authRouter.post('/host', (req, res) => {
  const result = loginBodySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Passcode is required' });
    return;
  }

  const expectedPasscode = process.env.HOST_PASSCODE;
  if (!expectedPasscode) {
    res.status(500).json({ error: 'Server authentication is not configured' });
    return;
  }

  if (!constantTimeCompare(result.data.passcode, expectedPasscode)) {
    res.status(401).json({ error: 'Incorrect passcode' });
    return;
  }

  const token = mintHostToken();
  res.json({ token });
});

authRouter.get('/me', requireHost, (_req, res) => {
  res.json({ role: 'host' });
});
