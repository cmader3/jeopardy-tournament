import { createBrowserRouter, RouterProvider } from 'react-router';
import { AdminRoute } from './routes/admin.js';
import { HostRoute } from './routes/host.js';
import { BoardRoute } from './routes/board.js';
import { PlayRoute } from './routes/play.js';
import { LandingRoute } from './routes/landing.js';
import './theme.css';

const router = createBrowserRouter([
  { path: '/', element: <LandingRoute /> },
  { path: '/admin', element: <AdminRoute /> },
  { path: '/host', element: <HostRoute /> },
  { path: '/board', element: <BoardRoute /> },
  { path: '/play', element: <PlayRoute /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
