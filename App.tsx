import React, { Suspense, lazy, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout, AdminLayout } from './components/Layout';
import { User, UserRole } from './types';
import { Icons } from './components/Icon';
import { ApiService } from './services/api';

import Home from './pages/Home';
import Login from './pages/Login';

const Vip = lazy(() => import('./pages/Vip'));
const Register = lazy(() => import('./pages/Register'));
const TutorialTtt = lazy(() => import('./pages/help/TutorialTtt'));
const TutorialMurder = lazy(() => import('./pages/help/TutorialMurder'));

const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Logs = lazy(() => import('./pages/admin/Logs'));
const Servers = lazy(() => import('./pages/admin/Servers'));
const ServerDetails = lazy(() => import('./pages/admin/ServerDetails'));
const DuplicateDetection = lazy(() => import('./pages/admin/DuplicateDetection'));
const Players = lazy(() => import('./pages/admin/Players'));
const PlayerProfile = lazy(() => import('./pages/admin/PlayerProfile'));
const Users = lazy(() => import('./pages/admin/Users'));
const Financial = lazy(() => import('./pages/admin/Financial'));
const Vips = lazy(() => import('./pages/admin/Vips'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const ImportLogs = lazy(() => import('./pages/admin/ImportLogs'));

const PageLoader = () => (
  <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-500">
    <Icons.Activity className="w-10 h-10 text-red-600 animate-spin mb-4" />
    <p className="text-sm font-mono animate-pulse">Carregando modulos...</p>
  </div>
);

const RouteAuthLoader = () => (
  <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-500">
    <Icons.Activity className="w-6 h-6 text-red-600 animate-spin mb-3" />
    <p className="text-xs font-mono uppercase tracking-wider">Validando sessao...</p>
  </div>
);

const useServerAuth = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const token = localStorage.getItem('backstabber_token');
      if (!token) {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      try {
        const me = await ApiService.getCurrentUser();
        if (!cancelled) {
          setUser(me);
        }
      } catch {
        if (!cancelled) {
          localStorage.removeItem('backstabber_token');
          localStorage.removeItem('backstabber_user');
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, user };
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading, user } = useServerAuth();

  if (loading) {
    return <RouteAuthLoader />;
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to="/admin/login" replace />;
  }

  if (user.role === UserRole.USER) {
    return <Navigate to="/" replace />;
  }

  return <AdminLayout>{children}</AdminLayout>;
};

const SuperAdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading, user } = useServerAuth();

  if (loading) {
    return <RouteAuthLoader />;
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to="/admin/login" replace />;
  }

  if (user.role !== UserRole.SUPERADMIN) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <AdminLayout>{children}</AdminLayout>;
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
          <Route path="/vip" element={<PublicLayout><Vip /></PublicLayout>} />
          <Route path="/tutorial/ttt" element={<PublicLayout><TutorialTtt /></PublicLayout>} />
          <Route path="/tutorial/murder" element={<PublicLayout><TutorialMurder /></PublicLayout>} />

          <Route path="/register" element={<Register />} />
          <Route path="/admin/login" element={<Login />} />

          <Route path="/admin/dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
          <Route path="/admin/financial" element={<AdminRoute><Financial /></AdminRoute>} />
          <Route path="/admin/vips" element={<AdminRoute><Vips /></AdminRoute>} />
          <Route path="/admin/players" element={<AdminRoute><Players /></AdminRoute>} />
          <Route path="/admin/players/:steamId" element={<AdminRoute><PlayerProfile /></AdminRoute>} />
          <Route path="/admin/logs" element={<AdminRoute><Logs /></AdminRoute>} />
          <Route path="/admin/import-logs" element={<AdminRoute><ImportLogs /></AdminRoute>} />
          <Route path="/admin/servers" element={<AdminRoute><Servers /></AdminRoute>} />
          <Route path="/admin/servers/:serverId" element={<AdminRoute><ServerDetails /></AdminRoute>} />
          <Route path="/admin/duplicates" element={<AdminRoute><DuplicateDetection /></AdminRoute>} />
          <Route path="/admin/users" element={<SuperAdminRoute><Users /></SuperAdminRoute>} />
          <Route path="/admin/settings" element={<AdminRoute><Settings /></AdminRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
};

export default App;
