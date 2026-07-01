import { Link } from 'react-router';
import styles from './landing.module.css';

interface EntryPoint {
  to: string;
  title: string;
  description: string;
}

const entryPoints: EntryPoint[] = [
  {
    to: '/admin',
    title: 'Admin',
    description: 'Create and edit game boards and import spreadsheets.',
  },
  {
    to: '/host',
    title: 'Host',
    description: 'Run a live game, manage the lobby, and control the board.',
  },
  {
    to: '/board',
    title: 'Board',
    description: 'Project the public board and scoreboard for a room.',
  },
  {
    to: '/play',
    title: 'Join',
    description: 'Enter a room code and name to play as a contestant.',
  },
];

export function LandingRoute() {
  return (
    <main className={styles.landing}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Jeopardy Tournament</h1>
        <p className={styles.subtitle}>Choose a role to get started.</p>
      </div>
      <nav className={styles.nav} aria-label="App entry points">
        {entryPoints.map((entry) => (
          <Link key={entry.to} to={entry.to} className={styles.card} aria-label={entry.title}>
            <h2 className={styles.cardTitle}>{entry.title}</h2>
            <p className={styles.cardDescription}>{entry.description}</p>
          </Link>
        ))}
      </nav>
    </main>
  );
}
