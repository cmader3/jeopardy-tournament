const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export async function loginHost(passcode: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/auth/host`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: 'Incorrect passcode' }))) as {
      error?: string;
    };
    throw new Error(body.error ?? 'Incorrect passcode');
  }

  const data = (await response.json()) as { token: string };
  return data.token;
}

export async function verifyHostToken(token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('Invalid token');
  }
}
