
import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PublicLayout, AdminLayout } from './components/Layout';
import { UserRole } from './types';
import { Icons } from './components/Icon';

// Eager load critical public pages
import Home from './pages/Home';
import Login from './pages/Login';

// Lazy load heavy components (Admin & Less used pages)
const Vip = lazy(() => import('./pages/Vip'));
const Register = lazy(() => import('./pages/Register'));
const TutorialTtt = lazy(() => import('./pages/help/TutorialTtt'));
const TutorialMurder = lazy(() => import('./pages/help/TutorialMurder'));

// Lazy load Admin Pages (Heavy charts, maps, logic)
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Logs = lazy(() => import('./pages/admin/Logs'));
const Servers = lazy(() => import('./pages/admin/Servers'));
const ServerDetails = lazy(() => import('./pages/admin/ServerDetails'));
const DuplicateDetection = lazy(() => import('./pages/admin/DuplicateDetection'));
const Players = lazy(() => import('./pages/admin/Players'));
const PlayerProfile = lazy(() => import('./pages/admin/PlayerProfile'));
const Users = lazy(() => import('./pages/admin/Users'));
const Financial = lazy(() => import('./pages/admin/Financial'));
const Settings = lazy(() => import('./pages/admin/Settings'));

// Loading Spinner Component
const PageLoader = () => (
  <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-500">
    <Icons.Activity className="w-10 h-10 text-red-600 animate-spin mb-4" />
    <p className="text-sm font-mono animate-pulse">Carregando módulos...</p>
  </div>
);

// Check Auth & Role Helper
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const userStr = localStorage.getItem('backstabber_user');
  
  if (!userStr) {
    return <Navigate to="/admin/login" replace />;
  }

  const user = JSON.parse(userStr);
  
  // Regular users cannot access admin panel
  if (user.role === UserRole.USER) {
    return <Navigate to="/" replace />;
  }

  return <AdminLayout>{children}</AdminLayout>;
};

// SuperAdmin Only Route
const SuperAdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const userStr = localStorage.getItem('backstabber_user');
    if (!userStr) return <Navigate to="/admin/login" replace />;
    
    const user = JSON.parse(userStr);
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
          {/* Public Routes */}
          <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
          <Route path="/vip" element={<PublicLayout><Vip /></PublicLayout>} />
          <Route path="/tutorial/ttt" element={<PublicLayout><TutorialTtt /></PublicLayout>} />
          <Route path="/tutorial/murder" element={<PublicLayout><TutorialMurder /></PublicLayout>} />
          
          {/* Auth Routes */}
          <Route path="/register" element={<Register />} />
          <Route path="/admin/login" element={<Login />} />

          {/* Protected Admin Routes */}
          <Route path="/admin/dashboard" element={
            <AdminRoute><Dashboard /></AdminRoute>
          } />
          <Route path="/admin/financial" element={
            <AdminRoute><Financial /></AdminRoute>
          } />
          <Route path="/admin/players" element={
            <AdminRoute><Players /></AdminRoute>
          } />
          <Route path="/admin/players/:steamId" element={
            <AdminRoute><PlayerProfile /></AdminRoute>
          } />
          <Route path="/admin/logs" element={
            <AdminRoute><Logs /></AdminRoute>
          } />
          <Route path="/admin/servers" element={
            <AdminRoute><Servers /></AdminRoute>
          } />
          <Route path="/admin/servers/:serverId" element={
            <AdminRoute><ServerDetails /></AdminRoute>
          } />
          <Route path="/admin/duplicates" element={
            <AdminRoute><DuplicateDetection /></AdminRoute>
          } />
          <Route path="/admin/users" element={
            <SuperAdminRoute><Users /></SuperAdminRoute>
          } />
          <Route path="/admin/settings" element={
            <AdminRoute><Settings /></AdminRoute>
          } />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
};

export default App;
