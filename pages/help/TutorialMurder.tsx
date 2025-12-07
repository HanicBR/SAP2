
import React from 'react';
import { Link } from 'react-router-dom';
import { Icons } from '../../components/Icon';

const TutorialMurder: React.FC = () => {
  return (
    <div className="bg-zinc-950 min-h-screen animate-fade-in pb-20">
      
      {/* 1. HERO SECTION */}
      <div className="relative bg-zinc-900 border-b border-zinc-800 overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://picsum.photos/seed/murder/1920/600?grayscale&blur=2')] opacity-10 bg-cover bg-center"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent"></div>
        
        <div className="relative max-w-7xl mx-auto px-4 py-20 sm:px-6 lg:px-8 flex flex-col items-center text-center">
          <div className="bg-zinc-800 p-4 rounded-full mb-6 border border-purple-900/50 shadow-[0_0_30px_rgba(88,28,135,0.3)]">
            <Icons.Skull className="w-10 h-10 text-purple-500" />
          </div>
          <h1 className="text-4xl md:text-6xl font-black text-white uppercase italic tracking-tighter mb-4">
            Tutorial <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-purple-600">Murder</span>
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl">
            Um assassino à solta. Uma arma escondida. Pistas espalhadas. Descubra quem é o criminoso antes que ele mate todos.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10">
        
        {/* 2. ROLES SECTION */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          
          {/* MURDERER */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden border border-red-900/50 shadow-lg shadow-red-900/10 group hover:-translate-y-1 transition-transform duration-300 relative">
            <div className="absolute inset-0 bg-gradient-to-b from-red-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="h-2 bg-red-600"></div>
            <div className="p-8 relative z-10">
              <div className="flex justify-between items-start mb-4">
                 <h2 className="text-2xl font-black text-red-500 uppercase">Murderer</h2>
                 <Icons.Skull className="w-8 h-8 text-red-600 opacity-50" />
              </div>
              <p className="text-zinc-300 text-sm mb-6 font-medium">Você é o predador. Seu objetivo é matar todos sem ser pego.</p>
              
              <div className="space-y-4">
                <div className="bg-red-900/10 p-3 rounded border border-red-900/20">
                   <p className="text-xs font-bold text-red-400 uppercase mb-1">Arma: Faca</p>
                   <p className="text-sm text-zinc-300">Mata com 1 hit. Pode ser arremessada.</p>
                </div>
                <ul className="space-y-2 text-sm text-zinc-400">
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-red-500 mt-0.5" /> <span className="text-white font-bold mr-1">Sprint:</span> Você corre mais rápido.</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-red-500 mt-0.5" /> <span className="text-white font-bold mr-1">Disfarce:</span> Aja como inocente.</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-red-500 mt-0.5" /> <span className="text-white font-bold mr-1">Arremesso:</span> Botão direito joga a faca.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* BYSTANDER */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden border border-blue-900/50 shadow-lg shadow-blue-900/10 group hover:-translate-y-1 transition-transform duration-300 relative">
            <div className="h-2 bg-blue-600"></div>
            <div className="p-8">
              <div className="flex justify-between items-start mb-4">
                 <h2 className="text-2xl font-black text-blue-500 uppercase">Bystander</h2>
                 <Icons.Users className="w-8 h-8 text-blue-600 opacity-50" />
              </div>
              <p className="text-zinc-300 text-sm mb-6 font-medium">A presa. Você está desarmado e vulnerável. Corra.</p>
              
              <div className="space-y-4">
                <div className="bg-blue-900/10 p-3 rounded border border-blue-900/20">
                   <p className="text-xs font-bold text-blue-400 uppercase mb-1">Objetivo</p>
                   <p className="text-sm text-zinc-300">Sobreviver ou encontrar a arma secreta.</p>
                </div>
                <ul className="space-y-2 text-sm text-zinc-400">
                   <li className="flex items-start"><Icons.Search className="w-4 h-4 mr-2 text-blue-500 mt-0.5" /> <span className="text-white font-bold mr-1">Pistas:</span> Colete itens verdes.</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-blue-500 mt-0.5" /> <span className="text-white font-bold mr-1">5 Pistas:</span> Ganhe uma arma.</li>
                   <li className="flex items-start"><Icons.Eye className="w-4 h-4 mr-2 text-blue-500 mt-0.5" /> Identifique o assassino.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ARMED BYSTANDER (SHERIFF) */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden border border-yellow-600/50 shadow-lg shadow-yellow-900/10 group hover:-translate-y-1 transition-transform duration-300 relative">
            <div className="h-2 bg-yellow-500"></div>
            <div className="p-8">
              <div className="flex justify-between items-start mb-4">
                 <h2 className="text-2xl font-black text-yellow-500 uppercase">Sheriff</h2>
                 <Icons.Crosshair className="w-8 h-8 text-yellow-600 opacity-50" />
              </div>
              <p className="text-zinc-300 text-sm mb-6 font-medium">O Inocente que começa com a arma (Magnum). A esperança.</p>
              
              <div className="space-y-4">
                <div className="bg-yellow-900/10 p-3 rounded border border-yellow-900/20">
                   <p className="text-xs font-bold text-yellow-500 uppercase mb-1">Arma: Magnum</p>
                   <p className="text-sm text-zinc-300">Um tiro mata. Munição infinita (com reload).</p>
                </div>
                <ul className="space-y-2 text-sm text-zinc-400">
                   <li className="flex items-start"><Icons.AlertTriangle className="w-4 h-4 mr-2 text-yellow-500 mt-0.5" /> <span className="text-white font-bold mr-1">Cuidado:</span> Não atire errado.</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-yellow-500 mt-0.5" /> Proteja os outros.</li>
                   <li className="flex items-start"><Icons.LogOut className="w-4 h-4 mr-2 text-yellow-500 mt-0.5" /> Se morrer, a arma cai.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* 3. MECHANICS SECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-16">
            
            {/* THE CLUES (PISTAS) */}
            <div className="bg-zinc-900 border border-green-900/30 rounded-xl p-8 relative overflow-hidden">
                <div className="absolute -right-10 -top-10 bg-green-500/10 w-40 h-40 rounded-full blur-3xl"></div>
                <h3 className="text-2xl font-bold text-white uppercase mb-4 flex items-center">
                    <Icons.Search className="w-6 h-6 mr-3 text-green-500" /> O Sistema de Pistas
                </h3>
                <p className="text-zinc-400 mb-6">
                    Espalhados pelo mapa, você encontrará itens brilhando em <span className="text-green-400 font-bold">VERDE</span>. Estes são "Loot" ou "Pistas".
                </p>
                <div className="space-y-4">
                    <div className="flex items-center bg-zinc-950 p-4 rounded border border-zinc-800">
                        <span className="text-4xl font-black text-green-500 mr-4">1</span>
                        <p className="text-sm text-zinc-300">Pressione <strong className="text-white bg-zinc-800 px-1 rounded">E</strong> para coletar uma pista.</p>
                    </div>
                    <div className="flex items-center bg-zinc-950 p-4 rounded border border-zinc-800">
                        <span className="text-4xl font-black text-green-500 mr-4">5</span>
                        <p className="text-sm text-zinc-300">Ao coletar <strong className="text-white">5 Pistas</strong>, você ganha uma Magnum automaticamente.</p>
                    </div>
                    <p className="text-xs text-zinc-500 italic mt-2">* O Assassino também pode coletar pistas para evitar que inocentes as peguem (mas ele não ganha arma extra).</p>
                </div>
            </div>

            {/* THE CURSE (FRIENDLY FIRE) */}
            <div className="bg-zinc-900 border border-red-900/30 rounded-xl p-8 relative overflow-hidden">
                <div className="absolute -right-10 -top-10 bg-red-500/10 w-40 h-40 rounded-full blur-3xl"></div>
                <h3 className="text-2xl font-bold text-white uppercase mb-4 flex items-center">
                    <Icons.AlertTriangle className="w-6 h-6 mr-3 text-red-500" /> Penalidade de Inocente
                </h3>
                <p className="text-zinc-400 mb-6">
                    Ter a arma é uma grande responsabilidade. O jogo pune severamente quem atira sem pensar.
                </p>
                <div className="bg-red-950/30 p-6 rounded border border-red-900/50 text-center">
                    <p className="text-red-400 font-bold uppercase mb-2">Se você atirar em um Inocente:</p>
                    <div className="inline-flex items-center justify-center space-x-8 mt-2">
                        <div className="text-center">
                            <Icons.Eye className="w-8 h-8 text-zinc-500 mx-auto mb-1" />
                            <span className="text-sm text-zinc-300">Fica Cego</span>
                        </div>
                        <div className="text-2xl text-zinc-600">+</div>
                        <div className="text-center">
                            <Icons.LogOut className="w-8 h-8 text-zinc-500 mx-auto mb-1" />
                            <span className="text-sm text-zinc-300">Larga a Arma</span>
                        </div>
                    </div>
                    <p className="text-xs text-red-300 mt-4 italic">
                        "Você cometeu um crime terrível e a culpa pesa sobre seus ombros..."
                    </p>
                </div>
            </div>

        </div>

        {/* 4. CONTROLS TABLE */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 mb-20">
            <h3 className="text-xl font-bold text-white uppercase mb-6 flex items-center">
                <Icons.Keyboard className="w-6 h-6 mr-3 text-purple-500" /> Controles Básicos
            </h3>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50">
                    <tr>
                        <th className="px-4 py-3 rounded-l">Tecla</th>
                        <th className="px-4 py-3 rounded-r">Ação</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                    <tr><td className="px-4 py-3 font-mono text-purple-400 font-bold">Botão Esq. (Mouse)</td><td className="px-4 py-3 text-zinc-300">Atirar (Magnum) / Estocar (Faca)</td></tr>
                    <tr><td className="px-4 py-3 font-mono text-purple-400 font-bold">Botão Dir. (Mouse)</td><td className="px-4 py-3 text-zinc-300">Arremessar Faca (Apenas Murderer - Cuidado, tem delay!)</td></tr>
                    <tr><td className="px-4 py-3 font-mono text-purple-400 font-bold">E</td><td className="px-4 py-3 text-zinc-300">Coletar pistas (Loot)</td></tr>
                    <tr><td className="px-4 py-3 font-mono text-purple-400 font-bold">F</td><td className="px-4 py-3 text-zinc-300">Lanterna (Essencial em mapas escuros)</td></tr>
                    <tr><td className="px-4 py-3 font-mono text-purple-400 font-bold">Shift</td><td className="px-4 py-3 text-zinc-300">Correr (Murderer corre mais rápido)</td></tr>
                </tbody>
                </table>
            </div>
        </div>

      </div>
    </div>
  );
};

export default TutorialMurder;
