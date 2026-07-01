import { useCallback, useEffect, useState } from 'react';
import { loginHost, verifyHostToken } from '../api/auth.js';

const STORAGE_KEY = 'jeopardy-host-token';

export interface UseHostAuthResult {
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (passcode: string) => Promise<void>;
  logout: () => void;
}

export function useHostAuth(): UseHostAuthResult {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [verified, setVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(() => localStorage.getItem(STORAGE_KEY) !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    verifyHostToken(token)
      .then(() => {
        if (!cancelled) {
          setVerified(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem(STORAGE_KEY);
          setToken(null);
          setVerified(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (passcode: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const newToken = await loginHost(passcode);
      localStorage.setItem(STORAGE_KEY, newToken);
      setToken(newToken);
    } catch (e) {
      setIsLoading(false);
      setError(e instanceof Error ? e.message : 'Login failed');
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setVerified(false);
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    token,
    isAuthenticated: token !== null && verified,
    isLoading,
    error,
    login,
    logout,
  };
}
