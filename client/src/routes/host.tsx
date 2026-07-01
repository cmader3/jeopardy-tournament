import { PasscodeGate } from '../components/PasscodeGate.js';

export function HostRoute() {
  return (
    <PasscodeGate>
      <main className="route-stub">
        <h1>Host</h1>
        <p>Game creation, lobby, and live controls will live here.</p>
      </main>
    </PasscodeGate>
  );
}
