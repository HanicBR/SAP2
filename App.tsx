import React, { Suspense, lazy, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout, AdminLayout } from './components/Layout';
import { User } from './types';
import { Icons } from './components/Icon';
import { ApiService } from './services/api';
import { AdminPageKey, canAccessAdminPage, isAdminRole } from './utils/adminAccess';

import Home from './pages/Home';
import Login from './pages/Login';

const Vip = lazy(() => import('./pages/Vip'));
const Register = lazy(() => import('./pages/Register'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
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
const LoadingScreens = lazy(() => import('./pages/admin/LoadingScreens'));

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

const AccessDeniedView = () => (
  <div className="mx-auto max-w-xl rounded border border-red-900/40 bg-zinc-900 p-6">
    <div className="flex items-center gap-3">
      <Icons.Shield className="h-5 w-5 text-red-400" />
      <h2 className="text-lg font-bold text-white">Acesso negado</h2>
    </div>
    <p className="mt-3 text-sm text-zinc-300">
      Acesso negado. Você não tem permissão para acessar esta página.
    </p>
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

const RoleRoute: React.FC<{ children: React.ReactNode; page: AdminPageKey }> = ({ children, page }) => {
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

  if (!isAdminRole(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (!canAccessAdminPage(user.role, page)) {
    return (
      <AdminLayout userOverride={user}>
        <AccessDeniedView />
      </AdminLayout>
    );
  }

  return <AdminLayout userOverride={user}>{children}</AdminLayout>;
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
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/admin/login" element={<Login />} />

          <Route path="/admin/dashboard" element={<RoleRoute page="dashboard"><Dashboard /></RoleRoute>} />
          <Route path="/admin/financial" element={<RoleRoute page="financial"><Financial /></RoleRoute>} />
          <Route path="/admin/vips" element={<RoleRoute page="vips"><Vips /></RoleRoute>} />
          <Route path="/admin/players" element={<RoleRoute page="players"><Players /></RoleRoute>} />
          <Route path="/admin/players/:steamId" element={<RoleRoute page="playerProfile"><PlayerProfile /></RoleRoute>} />
          <Route path="/admin/logs" element={<RoleRoute page="logs"><Logs /></RoleRoute>} />
          <Route path="/admin/import-logs" element={<RoleRoute page="importLogs"><ImportLogs /></RoleRoute>} />
          <Route path="/admin/servers" element={<RoleRoute page="servers"><Servers /></RoleRoute>} />
          <Route path="/admin/servers/:serverId" element={<RoleRoute page="serverDetails"><ServerDetails /></RoleRoute>} />
          <Route path="/admin/duplicates" element={<RoleRoute page="duplicates"><DuplicateDetection /></RoleRoute>} />
          <Route path="/admin/users" element={<RoleRoute page="users"><Users /></RoleRoute>} />
          <Route path="/admin/settings" element={<RoleRoute page="settings"><Settings /></RoleRoute>} />
          <Route path="/admin/loading-screens" element={<RoleRoute page="loadingScreens"><LoadingScreens /></RoleRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
};

export default App;
