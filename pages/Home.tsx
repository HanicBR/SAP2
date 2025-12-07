
import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api';
import { GameServer, ServerStatus } from '../types';
import { Icons } from '../components/Icon';
import { useConfig } from '../contexts/ConfigContext';

const Home: React.FC = () => {
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loading, setLoading] = useState(true);
  const { config } = useConfig();

  useEffect(() => {
    ApiService.getServers().then(data => {
      setServers(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Hero Section */}
      <div className="relative bg-zinc-950 overflow-hidden">
        <div className="absolute inset-0">
          <img 
            className="w-full h-full object-cover opacity-20"
            src={config.home.heroBackgroundUrl} 
            alt="Backstabber Background" 
            loading="lazy"
            decoding="async"
          />
          {/* Dark Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-brand/10"></div>
          {/* Scanlines Effect */}
          <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))', backgroundSize: '100% 2px, 3px 100%' }}></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto py-24 px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center">
          <div className="mb-6 animate-bounce">
            <Icons.Shield className="w-16 h-16 text-brand drop-shadow-[0_0_15px_var(--brand-color)]" />
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tight text-white mb-6 uppercase italic">
            {config.home.heroTitle} <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-brand-dark drop-shadow-lg">{config.home.heroTitleHighlight}</span>
          </h1>
          
          {/* DYNAMIC SUBTITLE RENDERER */}
          <p className="mt-4 max-w-lg mx-auto text-xl font-light">
            {config.home.heroSubtitleSegments.map((segment, index) => (
              <span key={index} style={{ color: segment.color, fontWeight: segment.color !== '#a1a1aa' ? 'bold' : 'normal' }}>
                {segment.text}
              </span>
            ))}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <a href={config.social.discordUrl} className="inline-flex items-center justify-center px-8 py-4 border border-transparent text-base font-bold rounded text-white bg-brand hover:bg-brand-hover transition-all shadow-[0_0_20px_rgba(185,28,28,0.3)] hover:shadow-[0_0_30px_rgba(185,28,28,0.5)] uppercase tracking-wide">
              {config.home.heroButtonText}
            </a>
            <a href="#servers" className="inline-flex items-center justify-center px-8 py-4 border border-zinc-700 text-base font-bold rounded text-zinc-300 bg-zinc-900/50 hover:bg-zinc-800 hover:text-white transition-all backdrop-blur-sm uppercase tracking-wide hover:border-cyan-500/50">
              Ver Servidores
            </a>
          </div>
        </div>
      </div>

      {/* Servers Section */}
      <div id="servers" className="py-20 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center mb-12">
            <div className="h-8 w-1 bg-brand mr-4 shadow-[0_0_10px_var(--brand-color)]"></div>
            <h2 className="text-3xl font-bold text-white uppercase tracking-wider">Nossos Servidores</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {loading ? (
              <p className="text-zinc-500">Carregando status dos servidores...</p>
            ) : (
              servers.map(server => (
                <div key={server.id} className="group bg-zinc-900 rounded border border-zinc-800 overflow-hidden hover:border-zinc-600 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,0,0,0.5)]">
                  <div className="h-32 bg-zinc-800 relative overflow-hidden">
                     {/* Placeholder Server Image */}
                     <img 
                        src={`https://picsum.photos/seed/${server.id}/400/200`} 
                        className="w-full h-full object-cover opacity-40 group-hover:scale-110 transition-transform duration-700 filter grayscale group-hover:grayscale-0" 
                        alt={server.name} 
                        loading="lazy"
                     />
                     <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent"></div>
                     <div className="absolute top-3 right-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase tracking-wider border ${
                          server.status === ServerStatus.ONLINE 
                          ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                          : 'bg-red-500/10 text-red-500 border-red-500/20'
                        }`}>
                          {server.status === ServerStatus.ONLINE ? 'Online' : 'Offline'}
                        </span>
                     </div>
                  </div>
                  <div className="p-6 relative">
                    <h3 className="text-lg font-bold text-white mb-1 truncate font-mono" title={server.name}>{server.name}</h3>
                    <p className="text-sm text-zinc-500 mb-6 font-medium uppercase tracking-wide">{server.mode} Mode</p>
                    
                    <div className="flex justify-between items-center text-sm text-zinc-400 mb-6 bg-zinc-950/50 p-3 rounded border border-zinc-800/50">
                      <div className="flex items-center">
                         <Icons.Users className="w-4 h-4 mr-2 text-zinc-500" />
                         <span className="font-mono text-white">{server.currentPlayers}</span>
                         <span className="text-zinc-600 mx-1">/</span>
                         <span className="font-mono">{server.maxPlayers}</span>
                      </div>
                      <div className="text-xs text-zinc-600 font-mono tracking-tighter">{server.ip}:{server.port}</div>
                    </div>

                    <button 
                      className={`w-full flex justify-center items-center py-3 px-4 border border-transparent rounded text-sm font-bold uppercase tracking-wider transition-all ${
                        server.status === ServerStatus.ONLINE 
                        ? 'bg-gradient-to-r from-brand to-brand-dark text-white hover:from-brand-hover hover:to-brand shadow-lg shadow-brand/20' 
                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border-zinc-700'
                      }`}
                      disabled={server.status !== ServerStatus.ONLINE}
                    >
                      {server.status === ServerStatus.ONLINE ? 'Conectar' : 'Indisponível'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-24 bg-zinc-900 border-t border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
           <div className="text-center mb-16">
             <h2 className="text-3xl font-black text-white uppercase tracking-tight">Por que escolher o <span className="text-brand">{config.general.siteName}</span>?</h2>
             <div className="w-24 h-1 bg-brand mx-auto mt-4"></div>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="p-8 bg-zinc-950 rounded border border-zinc-800 hover:border-brand/50 transition-colors group">
                <div className="w-14 h-14 bg-zinc-900 rounded flex items-center justify-center mb-6 text-brand group-hover:text-brand-light group-hover:scale-110 transition-all border border-zinc-800">
                  <Icons.Shield className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-brand-light transition-colors">{config.home.feature1Title}</h3>
                <p className="text-zinc-500 leading-relaxed">{config.home.feature1Desc}</p>
              </div>
              <div className="p-8 bg-zinc-950 rounded border border-zinc-800 hover:border-cyan-900/50 transition-colors group">
                <div className="w-14 h-14 bg-zinc-900 rounded flex items-center justify-center mb-6 text-cyan-500 group-hover:text-cyan-400 group-hover:scale-110 transition-all border border-zinc-800">
                  <Icons.Crown className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-cyan-400 transition-colors">{config.home.feature2Title}</h3>
                <p className="text-zinc-500 leading-relaxed">{config.home.feature2Desc}</p>
              </div>
              <div className="p-8 bg-zinc-950 rounded border border-zinc-800 hover:border-zinc-600 transition-colors group">
                <div className="w-14 h-14 bg-zinc-900 rounded flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-all border border-zinc-800">
                  <Icons.Activity className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{config.home.feature3Title}</h3>
                <p className="text-zinc-500 leading-relaxed">{config.home.feature3Desc}</p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Home;