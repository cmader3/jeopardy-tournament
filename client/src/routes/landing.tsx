import { Link } from 'react-router';

export function LandingRoute() {
  return (
    <main className="route-stub">
      <h1>Jeopardy Tournament</h1>
      <nav className="landing-nav">
        <Link to="/admin">Admin</Link>
        <Link to="/host">Host</Link>
        <Link to="/board">Board</Link>
        <Link to="/play">Play</Link>
      </nav>
    </main>
  );
}
