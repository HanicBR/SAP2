import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icons } from './Icon';
import { User, UserRole } from '../types';
import { useConfig } from '../contexts/ConfigContext';
import { AdminPageKey, canAccessAdminPage } from '../utils/adminAccess';

// --- PUBLIC LAYOUT ---

export const PublicLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { config } = useConfig();

  useEffect(() => {
    const uStr = localStorage.getItem('backstabber_user');
    if (uStr) setCurrentUser(JSON.parse(uStr));
  }, []);

  return (
    <div className="ui-shell min-h-screen flex flex-col bg-zinc-950 text-zinc-100 selection:bg-brand-dark selection:text-white">
      <header className="border-b border-zinc-800 bg-zinc-950/95 sticky top-0 z-50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex-shrink-0 flex items-center gap-2">
              {config.general.logoUrl ? (
                <img
                  src={config.general.logoUrl}
                  alt={config.general.siteName}
                  className="h-10 w-auto object-contain drop-shadow-[0_0_5px_rgba(0,0,0,0.5)]"
                />
              ) : (
                <div className="w-8 h-8 bg-brand rounded flex items-center justify-center shadow-[0_0_10px_var(--brand-color)]">
                  <Icons.Shield className="text-white w-5 h-5" />
                </div>
              )}
              <span
                className="font-extrabold text-xl tracking-tight text-white uppercase italic"
                style={{ textShadow: '2px 2px 0px rgba(0,0,0,0.5)' }}
              >
                {config.general.siteName}
              </span>
            </div>

            <nav className="hidden md:flex space-x-4 items-center">
              <Link
                to="/"
                className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900"
              >
                Inicio
              </Link>
              <Link
                to="/vip"
                className="text-zinc-300 hover:text-cyan-400 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900 flex items-center gap-2"
              >
                <Icons.Crown className="w-4 h-4" /> VIP Store
              </Link>
              <Link
                to="/tutorial/ttt"
                className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900"
              >
                Tutorial TTT
              </Link>
              <Link
                to="/tutorial/murder"
                className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900"
              >
                Tutorial Murder
              </Link>

              {currentUser ? (
                <>
                  {currentUser.role !== UserRole.USER && (
                    <Link
                      to="/admin/dashboard"
                      className="text-zinc-500 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Admin Panel
                    </Link>
                  )}
                  <div className="flex items-center gap-2 ml-4 pl-4 border-l border-zinc-800">
                    <span className="text-sm font-bold text-white">{currentUser.username}</span>
                    <button
                      onClick={() => {
                        localStorage.removeItem('backstabber_user');
                        localStorage.removeItem('backstabber_token');
                        window.location.reload();
                      }}
                      className="text-xs text-red-500 hover:text-red-400 uppercase font-bold"
                    >
                      Sair
                    </button>
                  </div>
                </>
              ) : (
                <Link
                  to="/admin/login"
                  className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded text-sm font-bold transition-colors"
                >
                  Entrar
                </Link>
              )}
            </nav>

            <div className="flex md:hidden">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-zinc-400 hover:text-white p-2"
              >
                {mobileMenuOpen ? <Icons.X /> : <Icons.Menu />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-zinc-900 border-b border-zinc-800">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
              <Link
                to="/"
                className="text-zinc-300 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium"
              >
                Inicio
              </Link>
              <Link
                to="/vip"
                className="text-cyan-400 hover:bg-zinc-800 hover:text-cyan-300 block px-3 py-2 rounded-md text-base font-medium"
              >
                VIP Store
              </Link>
              <Link
                to="/tutorial/ttt"
                className="text-zinc-400 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium"
              >
                Tutorial TTT
              </Link>
              <Link
                to="/tutorial/murder"
                className="text-zinc-400 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium"
              >
                Tutorial Murder
              </Link>
              <Link
                to="/admin/login"
                className="text-zinc-400 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium"
              >
                Admin / Login
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="flex-grow">{children}</main>

      <footer className="bg-black border-t border-zinc-900 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <p className="text-zinc-500 text-sm">
              &copy; {new Date().getFullYear()} {config.general.siteName}. Todos os direitos reservados.
            </p>
          </div>
          <div className="flex space-x-6 text-sm">
            <a href={config.social.discordUrl} className="text-zinc-500 hover:text-cyan-400 transition-colors">
              Discord
            </a>
            <Link to="/tutorial/ttt" className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
              <Icons.HelpCircle className="w-4 h-4" /> Ajuda / Tutorial
            </Link>
            <a href="#" className="text-zinc-500 hover:text-white transition-colors">
              Privacidade
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

// --- ADMIN LAYOUT ---

type AdminNavItem = {
  key: AdminPageKey;
  name: string;
  path: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  chipClass: string;
};

type AdminNavSection = {
  id: string;
  title: string;
  subtitle: string;
  items: AdminNavItem[];
};

const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    id: 'overview',
    title: 'Visao Geral',
    subtitle: 'Painel e observabilidade',
    items: [
      { key: 'dashboard', name: 'Dashboard', path: '/admin/dashboard', icon: Icons.BarChart, chipClass: 'border-cyan-700/70 bg-cyan-500/15 text-cyan-300' },
      { key: 'servers', name: 'Servidores', path: '/admin/servers', icon: Icons.Server, chipClass: 'border-emerald-700/70 bg-emerald-500/15 text-emerald-300' },
      { key: 'webViewer', name: 'Web Viewer', path: '/admin/web-viewer', icon: Icons.Map, chipClass: 'border-sky-700/70 bg-sky-500/15 text-sky-300' },
    ],
  },
  {
    id: 'community',
    title: 'Comunidade',
    subtitle: 'Jogadores e moderacao',
    items: [
      { key: 'players', name: 'Jogadores', path: '/admin/players', icon: Icons.UserGroup, chipClass: 'border-indigo-700/70 bg-indigo-500/15 text-indigo-300' },
      { key: 'vips', name: 'VIPs', path: '/admin/vips', icon: Icons.Crown, chipClass: 'border-amber-700/70 bg-amber-500/15 text-amber-300' },
      { key: 'logs', name: 'Logs e Eventos', path: '/admin/logs', icon: Icons.List, chipClass: 'border-fuchsia-700/70 bg-fuchsia-500/15 text-fuchsia-300' },
      { key: 'duplicates', name: 'Deteccao de Duplicatas', path: '/admin/duplicates', icon: Icons.Fingerprint, chipClass: 'border-rose-700/70 bg-rose-500/15 text-rose-300' },
    ],
  },
  {
    id: 'operations',
    title: 'Operacao',
    subtitle: 'Ferramentas do servidor',
    items: [
      { key: 'financial', name: 'Financeiro', path: '/admin/financial', icon: Icons.DollarSign, chipClass: 'border-lime-700/70 bg-lime-500/15 text-lime-300' },
      { key: 'addonCommands', name: 'Comandos Addon', path: '/admin/addon-commands', icon: Icons.Terminal, chipClass: 'border-violet-700/70 bg-violet-500/15 text-violet-300' },
      { key: 'loadingScreens', name: 'Telas de Loading', path: '/admin/loading-screens', icon: Icons.Image, chipClass: 'border-blue-700/70 bg-blue-500/15 text-blue-300' },
    ],
  },
  {
    id: 'system',
    title: 'Sistema',
    subtitle: 'Configuracoes e acesso',
    items: [
      { key: 'settings', name: 'Configuracoes Site', path: '/admin/settings', icon: Icons.Settings, chipClass: 'border-teal-700/70 bg-teal-500/15 text-teal-300' },
      { key: 'users', name: 'Usuarios do Sistema', path: '/admin/users', icon: Icons.Users, chipClass: 'border-orange-700/70 bg-orange-500/15 text-orange-300' },
    ],
  },
];

export const AdminLayout: React.FC<{ children: React.ReactNode; userOverride?: User | null }> = ({
  children,
  userOverride,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const { config } = useConfig();

  useEffect(() => {
    if (userOverride) {
      setUser(userOverride);
      return;
    }

    const userStr = localStorage.getItem('backstabber_user');
    if (!userStr) {
      navigate('/admin/login');
      return;
    }
    setUser(JSON.parse(userStr));
  }, [navigate, userOverride]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const visibleNavSections = ADMIN_NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessAdminPage(user?.role, item.key)),
    }))
    .filter((section) => section.items.length > 0);
  const visibleNavItems = visibleNavSections.flatMap((section) => section.items);
  const isActive = (path: string) => (
    location.pathname === path || location.pathname.startsWith(`${path}/`)
  );
  const activeNavItem = visibleNavItems.find((item) => isActive(item.path)) || null;

  const handleLogout = () => {
    localStorage.removeItem('backstabber_user');
    localStorage.removeItem('backstabber_token');
    navigate('/admin/login');
  };

  return (
    <div className="ui-shell ui-admin relative min-h-screen overflow-hidden text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_520px_at_-8%_-14%,rgba(239,68,68,0.14),transparent_54%),radial-gradient(1000px_560px_at_110%_116%,rgba(14,116,144,0.18),transparent_58%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:42px_42px]" />

      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/80 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Fechar menu"
        />
      )}

      <aside
        className={`
        fixed inset-y-0 left-0 z-50 w-[272px] border-r border-[#2a3347]/85 bg-[#0b101b]/92 backdrop-blur-xl shadow-[20px_0_60px_rgba(0,0,0,0.45)] transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}
      >
        <div className="h-20 border-b border-[#2a3347]/80 bg-black/35 px-5 flex items-center">
          <Link
            to="/"
            className="group flex items-center gap-3 hover:opacity-90 transition-opacity"
            title="Ir para o site"
          >
            {config.general.logoUrl ? (
              <img src={config.general.logoUrl} alt="Logo" className="h-10 w-auto max-w-[48px] object-contain" />
            ) : null}
            <div className="leading-tight">
              <p className="text-[22px] font-black tracking-tight uppercase text-white">
                {config.general.siteName.toUpperCase()}
              </p>
              <p className="-mt-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Control Panel</p>
            </div>
          </Link>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto admin-scrollbar px-3 pb-24 pt-4">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Navegacao</p>
          <div className="space-y-3">
            {visibleNavSections.map((section) => (
              <section
                key={section.id}
                className="rounded-xl border border-[#273248]/80 bg-[#0f1728]/65 px-2.5 py-2.5"
              >
                <div className="px-1.5 pb-1.5">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-300">{section.title}</p>
                  <p className="text-[10px] text-zinc-500">{section.subtitle}</p>
                </div>
                <nav className="space-y-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`group relative flex items-center rounded-xl border px-2.5 py-2.5 transition-all duration-200 ${
                        isActive(item.path)
                          ? 'border-red-700/55 bg-gradient-to-r from-red-900/30 via-red-900/10 to-transparent text-red-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                          : 'border-transparent text-zinc-400 hover:border-[#31405a] hover:bg-[#151d2c] hover:text-zinc-100'
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-2.5 h-6 w-[3px] rounded-r ${
                          isActive(item.path) ? 'bg-red-400' : 'bg-transparent'
                        }`}
                      />
                      <span
                        className={`mr-3 flex h-8 w-8 items-center justify-center rounded-lg border ${item.chipClass} ${
                          isActive(item.path) ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.12)]' : ''
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className="text-[13px] font-semibold leading-tight">{item.name}</span>
                    </Link>
                  ))}
                </nav>
              </section>
            ))}
          </div>
        </div>

        <div className="absolute bottom-0 w-full border-t border-[#2a3347]/85 bg-black/30 p-3">
          <div className="flex items-center gap-3 rounded-xl border border-[#2e3a52] bg-[#0f1625]/85 px-3 py-2.5">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-tr from-red-700 to-red-500 ring-2 ring-[#23304a]">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="Avatar" /> : <span className="text-xs font-black">AD</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-zinc-100 truncate">{user?.username || 'Admin'}</p>
              <p className="text-[10px] uppercase font-bold tracking-[0.14em] text-zinc-500 truncate">{user?.role || 'admin'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-[#33415b] bg-[#182235] p-2 text-zinc-300 transition-colors hover:bg-[#22314b] hover:text-white"
              title="Sair"
            >
              <Icons.LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-h-screen w-full flex-col md:pl-[272px]">
        <header className="h-16 border-b border-[#2b3448]/75 bg-[#0a101b]/82 px-4 backdrop-blur-xl md:px-6">
          <div className="flex h-full items-center justify-between">
            <button onClick={() => setSidebarOpen(true)} className="rounded-lg border border-[#2d3850] bg-[#131b2b] p-1.5 text-zinc-300 hover:text-white md:hidden" aria-label="Abrir menu">
              <Icons.Menu />
            </button>

            <div className="hidden md:flex items-center gap-3 min-w-0">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.95)]" />
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Admin Session</p>
                <p className="truncate text-sm font-semibold text-zinc-100">{activeNavItem?.name || 'Painel'}</p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden rounded-full border border-emerald-700/70 bg-emerald-900/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 sm:block">
                Online
              </span>
              <div className="hidden rounded-lg border border-[#2e3a52] bg-[#101826] px-3 py-1.5 text-[11px] text-zinc-400 sm:block">
                <span className="font-mono text-zinc-200">{now.toLocaleTimeString('pt-BR')}</span>
                <span className="mx-1 text-zinc-600">|</span>
                {now.toLocaleDateString('pt-BR')}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-7 admin-scrollbar">{children}</main>
      </div>
    </div>
  );
};
