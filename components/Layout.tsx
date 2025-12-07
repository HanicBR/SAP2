
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icons } from './Icon';
import { APP_NAME } from '../constants';
import { User, UserRole } from '../types';
import { useConfig } from '../contexts/ConfigContext';

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
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 selection:bg-brand-dark selection:text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/95 sticky top-0 z-50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            {/* Logo */}
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
              <span className="font-extrabold text-xl tracking-tight text-white uppercase italic" style={{ textShadow: '2px 2px 0px rgba(0,0,0,0.5)' }}>
                {config.general.siteName}
              </span>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden md:flex space-x-4 items-center">
              <Link to="/" className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900">Início</Link>
              <Link to="/vip" className="text-zinc-300 hover:text-cyan-400 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900 flex items-center gap-2">
                <Icons.Crown className="w-4 h-4" /> VIP Store
              </Link>
              
              {/* Tutorials - Separated Links */}
              <Link to="/tutorial/ttt" className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900">
                Tutorial TTT
              </Link>
              <Link to="/tutorial/murder" className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-zinc-900">
                Tutorial Murder
              </Link>

              {currentUser ? (
                <>
                   {currentUser.role !== UserRole.USER && (
                       <Link to="/admin/dashboard" className="text-zinc-500 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors">Admin Panel</Link>
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
                <Link to="/admin/login" className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded text-sm font-bold transition-colors">Entrar</Link>
              )}
            </nav>

            {/* Mobile Menu Button */}
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

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-zinc-900 border-b border-zinc-800">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
              <Link to="/" className="text-zinc-300 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium">Início</Link>
              <Link to="/vip" className="text-cyan-400 hover:bg-zinc-800 hover:text-cyan-300 block px-3 py-2 rounded-md text-base font-medium">VIP Store</Link>
              <Link to="/tutorial/ttt" className="text-zinc-400 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium">Tutorial TTT</Link>
              <Link to="/tutorial/murder" className="text-zinc-400 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium">Tutorial Murder</Link>
              <Link to="/admin/login" className="text-zinc-400 hover:bg-zinc-800 hover:text-white block px-3 py-2 rounded-md text-base font-medium">Admin / Login</Link>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-grow">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-black border-t border-zinc-900 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <p className="text-zinc-500 text-sm">&copy; {new Date().getFullYear()} {config.general.siteName}. Todos os direitos reservados.</p>
          </div>
          <div className="flex space-x-6 text-sm">
            <a href={config.social.discordUrl} className="text-zinc-500 hover:text-cyan-400 transition-colors">Discord</a>
            <Link to="/tutorial/ttt" className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
               <Icons.HelpCircle className="w-4 h-4" /> Ajuda / Tutorial
            </Link>
            <a href="#" className="text-zinc-500 hover:text-white transition-colors">Privacidade</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

// --- ADMIN LAYOUT ---

export const AdminLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const { config } = useConfig();

  useEffect(() => {
    const userStr = localStorage.getItem('backstabber_user');
    if (!userStr) {
        navigate('/admin/login');
        return;
    }
    setUser(JSON.parse(userStr));
  }, [navigate]);

  const navItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: Icons.BarChart },
    { name: 'Financeiro', path: '/admin/financial', icon: Icons.DollarSign },
    { name: 'Jogadores', path: '/admin/players', icon: Icons.UserGroup },
    { name: 'Logs e Eventos', path: '/admin/logs', icon: Icons.List },
    { name: 'Servidores', path: '/admin/servers', icon: Icons.Server },
    { name: 'Detecção de Duplicatas', path: '/admin/duplicates', icon: Icons.Fingerprint },
    { name: 'Configurações Site', path: '/admin/settings', icon: Icons.Settings },
  ];

  if (user?.role === UserRole.SUPERADMIN) {
      navItems.push({ name: 'Usuários do Sistema', path: '/admin/users', icon: Icons.Users });
  }

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = () => {
    localStorage.removeItem('backstabber_user');
    localStorage.removeItem('backstabber_token');
    navigate('/admin/login');
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex text-zinc-100">
      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/80 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800 transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:inset-auto
      `}>
        <div className="flex items-center justify-center h-16 border-b border-zinc-800 bg-zinc-950/50">
          <Link to="/" className="text-xl font-black text-white tracking-wider italic hover:opacity-80 transition-opacity flex items-center gap-2" title="Ir para o site">
            {config.general.logoUrl ? (
                <img src={config.general.logoUrl} alt="Logo" className="h-8 w-auto max-w-[40px] object-contain" />
            ) : null}
            <span>{config.general.siteName.toUpperCase()} <span className="text-brand">ADMIN</span></span>
          </Link>
        </div>
        <nav className="mt-6 px-4 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive(item.path)
                  ? 'bg-brand/10 text-brand border border-brand/50'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <item.icon className={`w-5 h-5 mr-3 ${isActive(item.path) ? 'text-brand' : ''}`} />
              <span className="font-medium">{item.name}</span>
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full p-4 border-t border-zinc-800">
          <button onClick={handleLogout} className="flex items-center text-zinc-500 hover:text-white transition-colors w-full">
            <Icons.LogOut className="w-5 h-5 mr-3" />
            Sair
          </button>
        </div>
      </aside>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="bg-zinc-900 border-b border-zinc-800 h-16 flex items-center justify-between px-4 md:px-8">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden text-zinc-400 hover:text-white">
            <Icons.Menu />
          </button>
          <div className="flex items-center ml-auto space-x-4">
             <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-brand to-brand-dark flex items-center justify-center overflow-hidden ring-2 ring-zinc-800">
                   {user?.avatarUrl ? <img src={user.avatarUrl} alt="Avatar" /> : <span className="text-xs font-bold">AD</span>}
                </div>
                <div className="hidden md:flex flex-col">
                   <span className="text-sm font-bold text-zinc-200 leading-tight">{user?.username}</span>
                   <span className="text-[10px] uppercase font-bold text-zinc-500">{user?.role}</span>
                </div>
             </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8 bg-black/20">
          {children}
        </main>
      </div>
    </div>
  );
};
