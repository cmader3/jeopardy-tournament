import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { AdminRoute } from './routes/admin.js';
import { HostRoute } from './routes/host.js';
import { BoardRoute } from './routes/board.js';
import { PlayRoute } from './routes/play.js';
import { LandingRoute } from './routes/landing.js';
import { RoleNav } from './components/RoleNav.js';
import './theme.css';

function RoleLayout() {
  return (
    <div className="app-shell">
      <RoleNav />
      <div className="app-main">
        <Outlet />
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <LandingRoute /> },
  {
    element: <RoleLayout />,
    children: [
      { path: '/admin', element: <AdminRoute /> },
      { path: '/host', element: <HostRoute /> },
      { path: '/board', element: <BoardRoute /> },
      { path: '/play', element: <PlayRoute /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
