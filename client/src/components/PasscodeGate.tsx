import { type FormEvent, type ReactNode, useState } from 'react';
import { useHostAuth } from '../auth/useHostAuth.js';

interface PasscodeGateProps {
  children: ReactNode;
}

export function PasscodeGate({ children }: PasscodeGateProps) {
  const { isAuthenticated, isLoading, error, login, logout } = useHostAuth();

  if (isLoading && !isAuthenticated) {
    return (
      <main className="passcode-gate">
        <p>Checking access...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <PasscodePrompt error={error} onSubmit={login} isLoading={isLoading} />;
  }

  return (
    <div className="protected-view">
      <header className="protected-header">
        <span className="protected-status">Host access active</span>
        <button
          type="button"
          onClick={logout}
          className="lock-button"
          aria-label="Lock host access"
        >
          Lock
        </button>
      </header>
      {children}
    </div>
  );
}

interface PasscodePromptProps {
  error: string | null;
  onSubmit: (passcode: string) => Promise<void>;
  isLoading: boolean;
}

function PasscodePrompt({ error, onSubmit, isLoading }: PasscodePromptProps) {
  const [passcode, setPasscode] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = passcode.trim();
    if (!trimmed) {
      return;
    }
    void onSubmit(trimmed);
  };

  return (
    <main className="passcode-gate">
      <h1>Enter Host Passcode</h1>
      <form onSubmit={handleSubmit} aria-label="Host passcode">
        <label htmlFor="host-passcode">Passcode</label>
        <input
          id="host-passcode"
          name="passcode"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          required
          autoFocus
          disabled={isLoading}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'passcode-error' : undefined}
        />
        {error && (
          <p id="passcode-error" className="passcode-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={isLoading || !passcode.trim()}>
          {isLoading ? 'Checking...' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
