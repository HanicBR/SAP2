
import React from 'react';
import { Link } from 'react-router-dom';
import { Icons } from '../../components/Icon';

const TutorialTtt: React.FC = () => {
  return (
    <div className="bg-zinc-950 min-h-screen animate-fade-in pb-20">
      
      {/* 1. HERO SECTION */}
      <div className="relative bg-zinc-900 border-b border-zinc-800 overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://picsum.photos/1920/600?grayscale&blur=2')] opacity-10 bg-cover bg-center"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent"></div>
        
        <div className="relative max-w-7xl mx-auto px-4 py-20 sm:px-6 lg:px-8 flex flex-col items-center text-center">
          <div className="bg-zinc-800 p-4 rounded-full mb-6 border border-zinc-700 shadow-xl">
            <Icons.Book className="w-10 h-10 text-cyan-400" />
          </div>
          <h1 className="text-4xl md:text-6xl font-black text-white uppercase italic tracking-tighter mb-4">
            Tutorial <span className="text-red-600">TTT</span>
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl">
            Detetive e Ladrão... mas com armas, traição e paranoia. Aprenda o básico para sobreviver no modo mais popular do Garry's Mod.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10">
        
        {/* 2. CLASSES SECTION - VISUAL CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          
          {/* INOCENTE */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden border border-green-900/50 shadow-lg shadow-green-900/10 group hover:-translate-y-1 transition-transform duration-300">
            <div className="h-2 bg-green-600"></div>
            <div className="p-8">
              <div className="flex justify-between items-start mb-4">
                 <h2 className="text-2xl font-black text-green-500 uppercase">Inocente</h2>
                 <Icons.Users className="w-8 h-8 text-green-600 opacity-50" />
              </div>
              <p className="text-zinc-300 text-sm mb-6 font-medium">A maioria dos jogadores. Você não sabe em quem confiar.</p>
              
              <div className="space-y-4">
                <div className="bg-green-900/10 p-3 rounded border border-green-900/20">
                   <p className="text-xs font-bold text-green-400 uppercase mb-1">Objetivo</p>
                   <p className="text-sm text-zinc-300">Sobreviver ou matar todos os Traidores.</p>
                </div>
                <ul className="space-y-2 text-sm text-zinc-400">
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-green-500 mt-0.5" /> Maior número</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-green-500 mt-0.5" /> Sem armas especiais</li>
                   <li className="flex items-start"><Icons.AlertTriangle className="w-4 h-4 mr-2 text-yellow-500 mt-0.5" /> Fogo amigo ativado</li>
                </ul>
              </div>
            </div>
          </div>

          {/* TRAIDOR */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden border border-red-900/50 shadow-lg shadow-red-900/10 group hover:-translate-y-1 transition-transform duration-300">
            <div className="h-2 bg-red-600"></div>
            <div className="p-8">
              <div className="flex justify-between items-start mb-4">
                 <h2 className="text-2xl font-black text-red-500 uppercase">Traidor</h2>
                 <Icons.Skull className="w-8 h-8 text-red-600 opacity-50" />
              </div>
              <p className="text-zinc-300 text-sm mb-6 font-medium">A minoria assassina. Vocês sabem quem são os parceiros.</p>
              
              <div className="space-y-4">
                <div className="bg-red-900/10 p-3 rounded border border-red-900/20">
                   <p className="text-xs font-bold text-red-400 uppercase mb-1">Objetivo</p>
                   <p className="text-sm text-zinc-300">Eliminar todos os Inocentes e Detetives.</p>
                </div>
                <ul className="space-y-2 text-sm text-zinc-400">
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-red-500 mt-0.5" /> Compra itens (Tecla C)</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-red-500 mt-0.5" /> Vê aliados marcados</li>
                   <li className="flex items-start"><Icons.Eye className="w-4 h-4 mr-2 text-red-500 mt-0.5" /> Age nas sombras</li>
                </ul>
              </div>
            </div>
          </div>

          {/* DETETIVE */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden border border-blue-900/50 shadow-lg shadow-blue-900/10 group hover:-translate-y-1 transition-transform duration-300">
            <div className="h-2 bg-blue-600"></div>
            <div className="p-8">
              <div className="flex justify-between items-start mb-4">
                 <h2 className="text-2xl font-black text-blue-500 uppercase">Detetive</h2>
                 <Icons.Shield className="w-8 h-8 text-blue-600 opacity-50" />
              </div>
              <p className="text-zinc-300 text-sm mb-6 font-medium">O líder dos inocentes. Possui ferramentas de investigação.</p>
              
              <div className="space-y-4">
                <div className="bg-blue-900/10 p-3 rounded border border-blue-900/20">
                   <p className="text-xs font-bold text-blue-400 uppercase mb-1">Objetivo</p>
                   <p className="text-sm text-zinc-300">Descobrir quem são os Traidores.</p>
                </div>
                <ul className="space-y-2 text-sm text-zinc-400">
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-blue-500 mt-0.5" /> Compra itens (Tecla C)</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-blue-500 mt-0.5" /> Analisa corpos (DNA)</li>
                   <li className="flex items-start"><Icons.Check className="w-4 h-4 mr-2 text-blue-500 mt-0.5" /> Dá ordens</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* 3. THE GOLDEN RULE (RDM) */}
        <div className="bg-red-950/30 border-l-4 border-red-600 p-8 rounded-r-xl mb-16 relative overflow-hidden">
           <div className="absolute right-0 top-0 opacity-10 transform translate-x-10 -translate-y-10">
              <Icons.AlertTriangle className="w-64 h-64 text-red-500" />
           </div>
           <div className="relative z-10">
              <h2 className="text-3xl font-black text-white uppercase mb-4 flex items-center gap-3">
                 <Icons.AlertTriangle className="w-8 h-8 text-red-500" />
                 A Regra de Ouro: RDM
              </h2>
              <div className="text-zinc-300 text-lg space-y-4 max-w-3xl">
                 <p>
                    <strong className="text-white">RDM (Random Death Match)</strong> é matar alguém sem prova concreta de que ele é traidor.
                 </p>
                 <p className="bg-red-900/20 p-4 rounded border border-red-900/30 inline-block">
                    <span className="text-red-400 font-bold">NÃO É PROVA:</span> "Ele olhou torto pra mim", "Ele está me seguindo", "Não fui com a cara dele".
                 </p>
                 <p className="bg-green-900/20 p-4 rounded border border-green-900/30 inline-block md:ml-4 mt-2 md:mt-0">
                    <span className="text-green-400 font-bold">É PROVA:</span> "Vi ele matando alguém", "Passou pela C4", "Atirou em mim".
                 </p>
                 <p className="text-sm text-zinc-500 italic mt-4">
                    * Violar esta regra resulta em Slay (morte na próxima rodada) ou Banimento.
                 </p>
              </div>
           </div>
        </div>

        {/* 4. GLOSSARY (DICIONÁRIO GAMER) */}
        <div className="mb-16">
           <h2 className="text-3xl font-bold text-white uppercase mb-8 flex items-center gap-3">
              <Icons.Book className="w-8 h-8 text-zinc-500" /> Termos Essenciais
           </h2>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                 { term: 'KOS', desc: 'Kill On Sight. Ordem para matar alguém ao avistar. Só use se tiver certeza.', color: 'border-red-500' },
                 { term: 'Proven', desc: 'Jogador provado Inocente (geralmente por Detetive ou Tester).', color: 'border-green-500' },
                 { term: 'MIA', desc: 'Missing In Action. Jogador que sumiu e pode ser Traidor.', color: 'border-yellow-500' },
                 { term: 'Jihad', desc: 'Bomba suicida de Traidor. Se ouvir um grito árabe, corra.', color: 'border-orange-500' },
                 { term: 'DNA', desc: 'Rastro deixado no corpo. O detetive usa para achar o assassino.', color: 'border-blue-500' },
                 { term: 'C4', desc: 'Bomba relógio plantada por Traidores. Pode ser desarmada (fio vermelho ou azul?).', color: 'border-red-700' },
                 { term: 'Ghosting', desc: 'Falar info do jogo morto (Discord/Steam). Proibido e dá BAN.', color: 'border-purple-500' },
                 { term: 'Camp', desc: 'Ficar parado num lugar só. Permitido, mas chato.', color: 'border-zinc-500' },
              ].map((item, i) => (
                 <div key={i} className={`bg-zinc-900 p-5 rounded border-l-4 ${item.color} shadow-sm`}>
                    <h3 className="text-xl font-black text-white mb-2">{item.term}</h3>
                    <p className="text-sm text-zinc-400">{item.desc}</p>
                 </div>
              ))}
           </div>
        </div>

        {/* 5. CHEAT SHEET (CONTROLS & ITEMS) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-20">
           
           {/* Controls */}
           <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
              <h3 className="text-xl font-bold text-white uppercase mb-6 flex items-center gap-3">
                 <Icons.Keyboard className="w-6 h-6 text-cyan-500" /> Teclas & Comandos
              </h3>
              <div className="overflow-x-auto">
                 <table className="w-full text-sm text-left">
                    <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50">
                       <tr>
                          <th className="px-4 py-3 rounded-l">Tecla / Comando</th>
                          <th className="px-4 py-3 rounded-r">Função</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                       <tr><td className="px-4 py-3 font-mono text-cyan-400 font-bold">C</td><td className="px-4 py-3 text-zinc-300">Abre a Loja (Traidor/Detetive)</td></tr>
                       <tr><td className="px-4 py-3 font-mono text-cyan-400 font-bold">Q</td><td className="px-4 py-3 text-zinc-300">Soltar arma atual</td></tr>
                       <tr><td className="px-4 py-3 font-mono text-cyan-400 font-bold">Shift (Segurar)</td><td className="px-4 py-3 text-zinc-300">Chat de voz exclusivo (Traidores)</td></tr>
                       <tr><td className="px-4 py-3 font-mono text-cyan-400 font-bold">F1</td><td className="px-4 py-3 text-zinc-300">Menu de Ajuda / Configs</td></tr>
                       <tr><td className="px-4 py-3 font-mono text-cyan-400 font-bold">F8 / !logs</td><td className="px-4 py-3 text-zinc-300">Ver logs de dano (Damage Log)</td></tr>
                       <tr><td className="px-4 py-3 font-mono text-yellow-500 font-bold">!report</td><td className="px-4 py-3 text-zinc-300">Denunciar jogador (RDM, ofensa)</td></tr>
                       <tr><td className="px-4 py-3 font-mono text-yellow-500 font-bold">!drops</td><td className="px-4 py-3 text-zinc-300">Ver drops de skins ganhos</td></tr>
                    </tbody>
                 </table>
              </div>
           </div>

           {/* Top Items */}
           <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
              <h3 className="text-xl font-bold text-white uppercase mb-6 flex items-center gap-3">
                 <Icons.Crown className="w-6 h-6 text-yellow-500" /> Itens Populares
              </h3>
              <div className="space-y-4">
                 <div className="flex gap-4 items-center bg-zinc-950/50 p-3 rounded border border-zinc-800">
                    <div className="w-10 h-10 bg-red-900/20 rounded flex items-center justify-center text-red-500 font-black text-xs border border-red-900/30">AWP</div>
                    <div>
                       <h4 className="text-white font-bold">Silent AWP (Traidor)</h4>
                       <p className="text-xs text-zinc-500">Mata com 1 tiro. Silenciosa. Cuidado ao errar.</p>
                    </div>
                 </div>
                 <div className="flex gap-4 items-center bg-zinc-950/50 p-3 rounded border border-zinc-800">
                    <div className="w-10 h-10 bg-blue-900/20 rounded flex items-center justify-center text-blue-500 font-black text-xs border border-blue-900/30">RAD</div>
                    <div>
                       <h4 className="text-white font-bold">Radar (Ambos)</h4>
                       <p className="text-xs text-zinc-500">Mostra a localização de todos a cada 30s. Item passivo.</p>
                    </div>
                 </div>
                 <div className="flex gap-4 items-center bg-zinc-950/50 p-3 rounded border border-zinc-800">
                    <div className="w-10 h-10 bg-red-900/20 rounded flex items-center justify-center text-red-500 font-black text-xs border border-red-900/30">C4</div>
                    <div>
                       <h4 className="text-white font-bold">C4 (Traidor)</h4>
                       <p className="text-xs text-zinc-500">Explosão massiva. Quanto maior o tempo, maior o raio.</p>
                    </div>
                 </div>
                 <div className="flex gap-4 items-center bg-zinc-950/50 p-3 rounded border border-zinc-800">
                    <div className="w-10 h-10 bg-blue-900/20 rounded flex items-center justify-center text-blue-500 font-black text-xs border border-blue-900/30">STA</div>
                    <div>
                       <h4 className="text-white font-bold">Health Station (Detetive)</h4>
                       <p className="text-xs text-zinc-500">Cura jogadores próximos. Pode ser hackeada por Traidores!</p>
                    </div>
                 </div>
              </div>
           </div>

        </div>

        {/* FOOTER CTA */}
        <div className="text-center pb-12">
           <p className="text-zinc-500 mb-4">Ainda com dúvidas?</p>
           <a 
              href="#" 
              className="inline-flex items-center justify-center px-8 py-3 border border-zinc-700 text-sm font-bold rounded text-zinc-300 bg-zinc-900 hover:bg-zinc-800 hover:text-white transition-all uppercase tracking-wide"
           >
              Ler Regras Completas
           </a>
        </div>

      </div>
    </div>
  );
};

export default TutorialTtt;
