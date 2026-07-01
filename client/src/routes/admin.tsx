import { PasscodeGate } from '../components/PasscodeGate.js';

export function AdminRoute() {
  return (
    <PasscodeGate>
      <main className="route-stub">
        <h1>Admin</h1>
        <p>Board library and authoring tools will live here.</p>
      </main>
    </PasscodeGate>
  );
}
