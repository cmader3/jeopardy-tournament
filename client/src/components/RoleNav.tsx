import { Link, NavLink } from 'react-router';
import styles from './RoleNav.module.css';

interface NavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Admin' },
  { to: '/host', label: 'Host' },
  { to: '/board', label: 'Board' },
  { to: '/play', label: 'Join' },
];

export function RoleNav() {
  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      <Link to="/" className={styles.brand}>
        Jeopardy
      </Link>
      <ul className={styles.links}>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
