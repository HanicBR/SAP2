
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ApiService } from '../../services/api';
import { LogEntry, LogType, GameMode, SiteConfig } from '../../types';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { Link } from 'react-router-dom';

// --- TYPE DEFINITIONS ---
interface RoundGroup {
  id: string;
  type: 'ROUND';
  mode: GameMode;
  events: LogEntry[];
  startTime: string;
  endTime?: string;
  winner?: string;
  duration?: number;
  roundNumber?: number;
  sessionId?: string;
  map?: string;
  sessionStart?: string;
  totalRoundsInSession?: number;
}

interface SessionGroup {
  id: string;
  type: 'SESSION';
  mode: GameMode;
  events: LogEntry[];
  startTime: string;
  steamId: string;
  playerName: string;
  ip?: string;
}

type LogItem = LogEntry | RoundGroup | SessionGroup;

// --- OPTIMIZATION: HELPER FUNCTIONS MOVED OUTSIDE COMPONENT ---

const getRoleColor = (role?: string) => {
  switch(role) {
    case 'traitor': return 'text-red-500 font-bold';
    case 'detective': return 'text-blue-500 font-bold';
    case 'innocent': return 'text-green-500 font-bold';
    case 'murderer': return 'text-red-500 font-bold';
    case 'bystander': return 'text-blue-500 font-bold';
    default: return 'text-zinc-400 font-bold';
  }
};

const getEventIcon = (type: LogType) => {
  switch(type) {
    case LogType.KILL: return <Icons.Skull className="w-4 h-4 text-red-500" />;
    case LogType.DAMAGE: return <Icons.Crosshair className="w-4 h-4 text-orange-400" />;
    case LogType.CHAT: return <Icons.MessageSquare className="w-4 h-4 text-blue-400" />;
    case LogType.CONNECT: return <Icons.Link2 className="w-4 h-4 text-green-500" />;
    case LogType.DISCONNECT: return <Icons.LogOut className="w-4 h-4 text-zinc-500" />;
    case LogType.PROP_SPAWN: return <Icons.Box className="w-4 h-4 text-yellow-500" />;
    case LogType.ULX:
    case LogType.COMMAND: return <Icons.Terminal className="w-4 h-4 text-purple-500" />;
    case LogType.ROUND_START: return <Icons.Clock className="w-4 h-4 text-cyan-500" />;
    case LogType.GAME_EVENT: return <Icons.Activity className="w-4 h-4 text-zinc-300" />;
    default: return <Icons.Activity className="w-4 h-4 text-zinc-500" />;
  }
};

const isRDM = (log: LogEntry) => {
  return log.gameMode === GameMode.TTT && 
         log.type === LogType.KILL && 
         log.metadata.attackerRole === 'innocent' && 
         log.metadata.victimRole === 'innocent';
};

// --- COMPONENT: PLAYER LINK ---
const PlayerLink = ({ name, steamId, role }: { name?: string, steamId?: string, role?: string }) => {
  const colorClass = getRoleColor(role);
  
  if (!name) return <span className="text-zinc-500">Desconhecido</span>;

  if (steamId) {
    return (
      <Link 
        to={`/admin/players/${steamId}`}
        onClick={(e) => e.stopPropagation()} 
        className={`${colorClass} hover:underline hover:text-cyan-400 transition-colors cursor-pointer`}
        title={`Ver perfil de ${name} (${steamId})`}
      >
        {name}
      </Link>
    );
  }

  return <span className={colorClass}>{name}</span>;
};

// --- COMPONENT: LOG ROW (Memoized) ---
const LogRow = React.memo(({
  log,
  showDate = true,
  onQuickIgnore,
}: {
  log: LogEntry;
  showDate?: boolean;
  onQuickIgnore?: (log: LogEntry) => void;
}) => {
  const rdm = isRDM(log);
  
  return (
    <div className={`p-2 hover:bg-zinc-800/50 flex items-start text-sm border-l-2 ${rdm ? 'border-red-600 bg-red-900/10' : 'border-transparent'} transition-colors group`}>
      {showDate && (
        <div className="w-20 flex-shrink-0 text-xs text-zinc-600 font-mono pt-0.5">
           {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
      
      <div className="mr-3 mt-0.5" title={log.type}>
        {getEventIcon(log.type)}
      </div>

      <div className="flex-1 break-words leading-relaxed">
         {log.type === LogType.CHAT ? (
           <span className="text-zinc-300">
              <span className="font-bold text-white">
                <PlayerLink name={log.playerName} steamId={log.steamId} role="none" />:
              </span> {log.metadata.message}
           </span>
         ) : log.type === LogType.KILL ? (
           <span>
              <PlayerLink 
                name={log.metadata.attackerName} 
                steamId={log.metadata.attackerSteamId} 
                role={log.metadata.attackerRole} 
              />
              <span className="text-zinc-500 mx-1">matou</span>
              <PlayerLink 
                name={log.metadata.victimName} 
                steamId={log.metadata.victimSteamId} 
                role={log.metadata.victimRole} 
              />
              <span className="text-zinc-600 text-xs ml-2 font-mono bg-black/30 px-1 rounded">[{log.metadata.weapon || 'world'}]</span>
              {rdm && <span className="ml-2 bg-red-600 text-white text-[10px] font-black px-1 rounded uppercase animate-pulse">RDM Detectado</span>}
           </span>
         ) : log.type === LogType.DAMAGE ? (
           <span>
              <PlayerLink 
                name={log.metadata.attackerName} 
                steamId={log.metadata.attackerSteamId} 
                role={log.metadata.attackerRole} 
              />
              <span className="text-zinc-500 mx-1">atacou</span>
              <PlayerLink 
                name={log.metadata.victimName} 
                steamId={log.metadata.victimSteamId} 
                role={log.metadata.victimRole} 
              />
              <span className="text-zinc-500 text-xs ml-1">(-{log.metadata.damage} HP)</span>
           </span>
         ) : log.type === LogType.PROP_SPAWN ? (
            <span>
               <PlayerLink name={log.playerName} steamId={log.steamId} role="none" />
               <span className="text-zinc-500 mx-1">spawnou</span>
               <span className="text-yellow-500/80 font-mono text-xs">{log.metadata.propModel}</span>
            </span>
         ) : (
           <span className="text-zinc-400">
              {log.playerName && (
                <span className="mr-1">
                   <PlayerLink name={log.playerName} steamId={log.steamId} role="none" />
                </span>
              )}
              {log.rawText.replace(log.playerName || '', '').trim()}
           </span>
         )}
      </div>
      
      <div className="opacity-0 group-hover:opacity-100 flex gap-2 transition-opacity">
        <button
          title="Adicionar filtro de spam a partir deste log"
          className="text-zinc-600 hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation();
            if (onQuickIgnore) onQuickIgnore(log);
          }}
        >
          <Icons.X className="w-3 h-3" />
        </button>
        <button
          title="Copiar SteamID (ou ID do log)"
          className="text-zinc-600 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            const valueToCopy = log.steamId || log.id;
            if (navigator && (navigator as any).clipboard && valueToCopy) {
              (navigator as any).clipboard.writeText(valueToCopy).catch(() => undefined);
            }
          }}
        >
          <Icons.Copy className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});

// --- COMPONENT: SPAM CLUSTER (Memoized) ---
const SpamCluster = React.memo(({ logs, onQuickIgnore }: { logs: LogEntry[]; onQuickIgnore?: (log: LogEntry) => void }) => {
  const first = logs[0];
  const count = logs.length;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-yellow-900/10 border border-yellow-900/30 rounded my-1">
       <div 
          className="p-2 flex items-center cursor-pointer hover:bg-yellow-900/20 transition-colors"
          onClick={() => setExpanded(!expanded)}
       >
          <div className="mr-3"><Icons.AlertTriangle className="w-4 h-4 text-yellow-500" /></div>
          <div className="flex-1 text-sm text-yellow-200/80">
             <span className="font-bold text-yellow-500">
                <PlayerLink name={first.playerName} steamId={first.steamId} />
             </span> spawnou <span className="font-bold">{count} props</span> em sequência.
          </div>
          <div className="text-xs text-yellow-500/50 font-bold uppercase">{expanded ? 'Recolher' : 'Expandir'}</div>
       </div>
       {expanded && (
          <div className="pl-8 pr-2 pb-2">
             {logs.map(log => (
               <LogRow key={log.id} log={log} onQuickIgnore={onQuickIgnore} />
             ))}
          </div>
       )}
    </div>
  );
});

// --- COMPONENT: ROUND CARD (Memoized) ---
const RoundCard = React.memo(({ group, onQuickIgnore }: { group: RoundGroup; onQuickIgnore?: (log: LogEntry) => void }) => {
  const [expanded, setExpanded] = useState(true); 
  
  // Calculate RDM count for summary
  const rdms = group.events.filter(e => isRDM(e)).length;
  
  const winnerColor = group.winner === 'traitor' 
    ? 'text-red-500 border-red-900/50 bg-red-900/10' 
    : 'text-green-500 border-green-900/50 bg-green-900/10';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden mb-4 shadow-sm">
       <div 
          className={`p-3 border-b border-zinc-800 flex justify-between items-center cursor-pointer hover:bg-zinc-800/50 transition-colors ${group.winner ? winnerColor : 'bg-zinc-900'}`}
          onClick={() => setExpanded(!expanded)}
       >
         <div className="flex items-center gap-4">
             <div className="flex items-center gap-2">
                <Icons.Clock className="w-4 h-4 opacity-70" />
                <span className="font-mono text-sm text-zinc-400">{new Date(group.startTime).toLocaleTimeString()}</span>
             </div>
             <div>
                <span className="text-sm font-black uppercase tracking-wider block">
                   Rodada {group.roundNumber ?? '?'}
                   {typeof group.totalRoundsInSession === 'number' && group.totalRoundsInSession > 0 && (
                     <span className="text-xs font-normal text-zinc-500 ml-1">
                       / {group.totalRoundsInSession}
                     </span>
                   )}
                </span>
                {group.winner && (
                   <span className="text-xs font-bold opacity-80">
                      Vencedores: {group.winner === 'traitor' ? 'Traidores' : 'Inocentes'}
                   </span>
                )}
             </div>
          </div>
          
          <div className="flex items-center gap-4">
             {rdms > 0 && (
                <span className="flex items-center text-xs font-black text-red-500 bg-red-950 px-2 py-1 rounded border border-red-900">
                   <Icons.AlertTriangle className="w-3 h-3 mr-1" /> {rdms} RDMs
                </span>
             )}
             <span className="text-xs text-zinc-500 font-bold uppercase">
                {group.events.length} Eventos
             </span>
             <Icons.List className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
       </div>

        {expanded && (
           <div className="divide-y divide-zinc-800/50">
              {group.events.map(log => (
                 <LogRow key={log.id} log={log} showDate={true} onQuickIgnore={onQuickIgnore} />
              ))}
           </div>
        )}
     </div>
  );
});

// --- COMPONENT: SESSION CARD (Memoized) ---
const SessionCard = React.memo(({ group, onQuickIgnore }: { group: SessionGroup; onQuickIgnore?: (log: LogEntry) => void }) => {
  const [expanded, setExpanded] = useState(true);

  // Group prop spawns into clusters for Sandbox
  const groupedEvents = useMemo(() => {
     const result: (LogEntry | LogEntry[])[] = [];
     let currentSpam: LogEntry[] = [];

     group.events.forEach((log, index) => {
        // Detect spam (consecutive prop spawns)
        if (log.type === LogType.PROP_SPAWN) {
           const prev = group.events[index - 1];
           // Simple check: same type and close time (less than 2s apart)
           if (prev && prev.type === LogType.PROP_SPAWN && (new Date(log.timestamp).getTime() - new Date(prev.timestamp).getTime() < 2000)) {
               currentSpam.push(log);
           } else {
               if (currentSpam.length > 0) {
                   result.push(currentSpam);
                   currentSpam = [];
               }
               currentSpam.push(log);
           }
        } else {
           if (currentSpam.length > 0) {
               // Determine if it's a "cluster" (more than 3) or just individual events
               if (currentSpam.length > 3) result.push(currentSpam);
               else currentSpam.forEach(l => result.push(l));
               currentSpam = [];
           }
           result.push(log);
        }
     });
     
     // Flush remaining
     if (currentSpam.length > 0) {
        if (currentSpam.length > 3) result.push(currentSpam);
        else currentSpam.forEach(l => result.push(l));
     }

     return result;
  }, [group.events]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden mb-4 shadow-sm">
       <div 
          className="p-3 bg-zinc-950/50 border-b border-zinc-800 flex justify-between items-center cursor-pointer hover:bg-zinc-900 transition-colors"
          onClick={() => setExpanded(!expanded)}
       >
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-900/20 rounded-full">
                <Icons.UserGroup className="w-4 h-4 text-blue-500" />
             </div>
             <div>
                <p className="text-sm font-bold text-white">
                   Sessão de <PlayerLink name={group.playerName} steamId={group.steamId} />
                </p>
                <div className="flex gap-2 text-xs text-zinc-500 font-mono">
                   <span>{group.ip}</span>
                   <span>•</span>
                   <span>Início: {new Date(group.startTime).toLocaleTimeString()}</span>
                </div>
             </div>
          </div>
          <div className="flex items-center gap-2">
             <span className="text-xs font-bold text-zinc-600">{group.events.length} logs</span>
             <Icons.List className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
       </div>

        {expanded && (
           <div className="divide-y divide-zinc-800/50">
              {groupedEvents.map((item, idx) => {
                 if (Array.isArray(item)) {
                    return <SpamCluster key={`spam_${idx}`} logs={item} onQuickIgnore={onQuickIgnore} />;
                 }
                 return <LogRow key={item.id} log={item} onQuickIgnore={onQuickIgnore} />;
              })}
           </div>
        )}
     </div>
  );
});

// --- MAIN PAGE COMPONENT ---
const Logs: React.FC = () => {
  const [rawLogs, setRawLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');
  const [selectedMode, setSelectedMode] = useState<GameMode | 'ALL'>('ALL');
  const [logTypeFilter, setLogTypeFilter] = useState<string>('ALL');

  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [ignoreToolsInput, setIgnoreToolsInput] = useState('');
  const [ignoreCommandsInput, setIgnoreCommandsInput] = useState('');
  const [ignoreRawTextInput, setIgnoreRawTextInput] = useState('');
  const [ignoreStats, setIgnoreStats] = useState<{ tools: Record<string, number>; commands: Record<string, number>; rawText: Record<string, number> } | null>(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    loadLogs();
    ApiService.getSiteConfig().then((cfg) => {
      setSiteConfig(cfg);
      const logsCfg = cfg.logs || {};
      setIgnoreToolsInput((logsCfg.ignoredTools || []).join(', '));
      setIgnoreCommandsInput((logsCfg.ignoredCommands || []).join(', '));
      setIgnoreRawTextInput((logsCfg.rawTextFilters || []).join(', '));
    });
    ApiService.getIngestStats().then((stats) => setIgnoreStats(stats));
  }, []);

  const loadLogs = () => {
    setLoading(true);
    // In real app, we would pass filters to API here
    ApiService.getEvents().then(data => {
      setRawLogs(data as LogEntry[]);
      setLoading(false);
    });
  };

  // --- MEMOIZED GROUPING & FILTERING LOGIC ---
  // This performs the heavy lifting of sorting, filtering, and structuring the logs
  const processedData = useMemo(() => {
     let filtered = rawLogs;

     // 1. Text Search
     if (search) {
        const lower = search.toLowerCase();
        filtered = filtered.filter(l => 
           l.playerName?.toLowerCase().includes(lower) || 
           l.steamId?.toLowerCase().includes(lower) || 
           l.rawText.toLowerCase().includes(lower)
        );
     }

     // 2. Mode Filter
     if (selectedMode !== 'ALL') {
        filtered = filtered.filter(l => l.gameMode === selectedMode);
     }

     // 3. Type Filter
     if (logTypeFilter !== 'ALL') {
        filtered = filtered.filter(l => l.type === logTypeFilter);
     }

     // 4. Grouping Logic
     const result: LogItem[] = [];
     
    if (selectedMode === GameMode.TTT) {
       const groups: Record<string, RoundGroup> = {};
       const looseLogs: LogEntry[] = [];

       filtered.forEach((log) => {
         const meta: any = log.metadata || {};
         const roundId = meta.roundId as string | undefined;

         if (roundId) {
           if (!groups[roundId]) {
             let roundNumber: number | undefined;
             if (typeof meta.roundNumber === "number") {
               roundNumber = meta.roundNumber;
             } else if (typeof meta.roundNumber === "string") {
               const parsed = parseInt(meta.roundNumber, 10);
               if (!isNaN(parsed)) roundNumber = parsed;
             }

             groups[roundId] = {
               id: roundId,
               type: "ROUND",
               mode: GameMode.TTT,
               events: [],
               startTime: log.timestamp,
               roundNumber,
               sessionId: meta.serverSessionId || meta.sessionId,
               map: meta.map,
               sessionStart: meta.sessionStart,
             };
           }

           const group = groups[roundId];
           group.events.push(log);

           if (!group.roundNumber) {
             if (typeof meta.roundNumber === "number") {
               group.roundNumber = meta.roundNumber;
             } else if (typeof meta.roundNumber === "string") {
               const parsed2 = parseInt(meta.roundNumber, 10);
               if (!isNaN(parsed2)) group.roundNumber = parsed2;
             }
           }

           if (!group.map && meta.map) {
             group.map = meta.map;
           }
           if (!group.sessionId && (meta.serverSessionId || meta.sessionId)) {
             group.sessionId = meta.serverSessionId || meta.sessionId;
           }
           if (!group.sessionStart && meta.sessionStart) {
             group.sessionStart = meta.sessionStart;
           }

           if (log.type === LogType.ROUND_START) {
             group.startTime = log.timestamp;
           } else if (log.type === LogType.ROUND_END) {
             group.endTime = log.timestamp;
             group.winner = meta.winner;
           }
         } else {
           looseLogs.push(log);
         }
       });

       const allGroups = Object.values(groups);
       const sessions: Record<string, RoundGroup[]> = {};

       allGroups.forEach((g) => {
         const sessionKey = (g.sessionId || "LEGACY") + "::" + (g.map || "DESCONHECIDO");
         if (!sessions[sessionKey]) sessions[sessionKey] = [];
         sessions[sessionKey].push(g);
       });

       Object.values(sessions).forEach((sessionGroups) => {
         sessionGroups.sort(
           (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
         );
         const total = sessionGroups.length;
         sessionGroups.forEach((g, idx) => {
           g.events.sort(
             (a, b) =>
               new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
           );
           if (!g.roundNumber || g.roundNumber <= 0) {
             g.roundNumber = idx + 1;
           }
           g.totalRoundsInSession = total;
           result.push(g);
         });
       });

       looseLogs.forEach((l) => result.push(l));

    } else if (selectedMode === GameMode.SANDBOX) {
        // Sandbox: Group by Player Sessions
        // Note: In real app this is complex. Here we use 'steamId' + 'Connect' event as delimiters or just group by SteamID for demo
        // For this Mock, we will group purely by unique SteamID appearing in the filtered logs to create "Player Cards"
        
        const sessions: Record<string, SessionGroup> = {};
        const looseLogs: LogEntry[] = [];

        filtered.forEach(log => {
           if (log.steamId) {
              if (!sessions[log.steamId]) {
                 sessions[log.steamId] = {
                    id: `sess_${log.steamId}`,
                    type: 'SESSION',
                    mode: GameMode.SANDBOX,
                    events: [],
                    startTime: log.timestamp,
                    steamId: log.steamId,
                    playerName: log.playerName || 'Unknown',
                    ip: log.metadata.ip
                 };
              }
              sessions[log.steamId].events.push(log);
           } else {
              looseLogs.push(log);
           }
        });

        Object.values(sessions).forEach(s => {
           s.events.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
           result.push(s);
        });
        looseLogs.forEach(l => result.push(l));

     } else {
        // Default / Mixed View: Just list logs
        // If we wanted mixed grouping we could, but flat list is safer for 'ALL'
        return filtered; 
     }

     // Sort final result by time (Groups use startTime)
     return result.sort((a, b) => {
        const tA = 'startTime' in a ? a.startTime : a.timestamp;
        const tB = 'startTime' in b ? b.startTime : b.timestamp;
        return new Date(tB).getTime() - new Date(tA).getTime();
     });

  }, [rawLogs, search, selectedMode, logTypeFilter]);

  // Pagination Logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = processedData.slice(indexOfFirstItem, indexOfLastItem);

  // Handlers
  const handlePageChange = useCallback((page: number) => {
     setCurrentPage(page);
     window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSaveIgnoreRules = async () => {
    if (!siteConfig) return;
    const parseList = (value: string) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const next: SiteConfig = {
      ...siteConfig,
      logs: {
        ignoredTools: parseList(ignoreToolsInput),
        ignoredCommands: parseList(ignoreCommandsInput),
        rawTextFilters: parseList(ignoreRawTextInput),
      },
    };

    const updated = await ApiService.updateSiteConfig(next);
    setSiteConfig(updated);
    alert('Regras de ignorar logs salvas. Novos eventos que baterem nessas regras não serão armazenados.');
    const stats = await ApiService.getIngestStats();
    setIgnoreStats(stats);
  };

  const handleQuickIgnore = (log: LogEntry) => {
    const parseList = (value: string) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const tools = parseList(ignoreToolsInput);
    const commands = parseList(ignoreCommandsInput);
    const raws = parseList(ignoreRawTextInput);

    if (log.type === LogType.TOOL_USE && log.metadata.toolName) {
      const toolName = String(log.metadata.toolName);
      if (!tools.find((t) => t.toLowerCase() === toolName.toLowerCase())) {
        tools.push(toolName);
      }
    } else if ((log.type === LogType.COMMAND || log.type === LogType.ULX) && log.metadata.command) {
      const cmdName = String(log.metadata.command);
      if (!commands.find((c) => c.toLowerCase() === cmdName.toLowerCase())) {
        commands.push(cmdName);
      }
    } else {
      const snippet = log.rawText.slice(0, 80);
      if (!raws.find((r) => r.toLowerCase() === snippet.toLowerCase())) {
        raws.push(snippet);
      }
    }

    setIgnoreToolsInput(tools.join(', '));
    setIgnoreCommandsInput(commands.join(', '));
    setIgnoreRawTextInput(raws.join(', '));

    alert('Filtro sugerido preenchido nos campos acima. Clique em "Salvar filtros" para aplicar.');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold text-white flex items-center">
          <Icons.List className="w-6 h-6 mr-3 text-red-500" />
          Centro de Investigação
        </h1>
        
        <div className="flex bg-zinc-900 p-1 rounded border border-zinc-800">
           {['ALL', GameMode.TTT, GameMode.SANDBOX, GameMode.MURDER].map((mode) => (
              <button
                 key={mode}
                 onClick={() => { setSelectedMode(mode as any); setCurrentPage(1); }}
                 className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                    selectedMode === mode 
                       ? 'bg-zinc-800 text-white shadow-sm' 
                       : 'text-zinc-500 hover:text-zinc-300'
                 }`}
              >
                 {mode === 'ALL' ? 'Todos' : mode}
              </button>
           ))}
        </div>
      </div>

      {/* Filter Bar + Ignore Rules */}
      <div className="space-y-3">
        <div className="bg-zinc-900 p-4 rounded border border-zinc-800 flex flex-col md:flex-row gap-4">
           <div className="flex-1 relative">
              <Icons.Search className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
              <input 
                 type="text" 
                 className="w-full bg-zinc-950 border border-zinc-700 rounded pl-10 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
                 placeholder="Pesquisar por Nick, SteamID ou Conteúdo..."
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
              />
           </div>
           <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
               <Icons.Filter className="w-4 h-4 text-zinc-500 mr-2 flex-shrink-0" />
               {['ALL', LogType.CHAT, LogType.KILL, LogType.DAMAGE, LogType.COMMAND, LogType.CONNECT].map(type => (
                  <button
                     key={type}
                     onClick={() => setLogTypeFilter(type)}
                     className={`px-3 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap ${
                        logTypeFilter === type 
                           ? 'bg-red-900/20 text-red-400 border-red-900/50' 
                           : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:border-zinc-600'
                     }`}
                  >
                     {type}
                  </button>
               ))}
           </div>
        </div>

        <div className="bg-zinc-900 p-4 rounded border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icons.Shield className="w-4 h-4 text-red-500" />
              <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
                Filtros de Spam (não salvar logs novos)
              </span>
            </div>
            {ignoreStats && (
              <div className="text-[10px] text-zinc-500 flex flex-wrap gap-3">
                {Object.keys(ignoreStats.tools).length > 0 && (
                  <span>
                    Tools ignoradas:{' '}
                    {Object.entries(ignoreStats.tools)
                      .slice(0, 3)
                      .map(([k, v]) => `${k} (${v})`)
                      .join(', ')}
                  </span>
                )}
                {Object.keys(ignoreStats.commands).length > 0 && (
                  <span>
                    Commands ignorados:{' '}
                    {Object.entries(ignoreStats.commands)
                      .slice(0, 3)
                      .map(([k, v]) => `${k} (${v})`)
                      .join(', ')}
                  </span>
                )}
                {Object.keys(ignoreStats.rawText).length > 0 && (
                  <span>
                    Textos ignorados:{' '}
                    {Object.entries(ignoreStats.rawText)
                      .slice(0, 2)
                      .map(([k, v]) => `${k} (${v})`)
                      .join(', ')}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                Ignorar Tools (TOOL_USE)
              </label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:border-red-500 focus:outline-none"
                placeholder="wire_pod, wire_hoverdrivecontroller"
                value={ignoreToolsInput}
                onChange={(e) => setIgnoreToolsInput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                Ignorar Commands (COMMAND/ULX)
              </label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:border-red-500 focus:outline-none"
                placeholder="!rtv, !menu"
                value={ignoreCommandsInput}
                onChange={(e) => setIgnoreCommandsInput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
                Ignorar por Texto (rawText)
              </label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:border-red-500 focus:outline-none"
                placeholder="wire_hoverdrivecontroller, used property 'extinguish'"
                value={ignoreRawTextInput}
                onChange={(e) => setIgnoreRawTextInput(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSaveIgnoreRules}
              className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-xs font-bold uppercase rounded border border-red-800 text-white"
            >
              Salvar filtros
            </button>
          </div>
        </div>
      </div>

      {/* Logs Container */}
      <div className="bg-zinc-950 rounded border border-zinc-800 min-h-[500px] flex flex-col">
         {loading ? (
            <div className="p-8 text-center text-zinc-500">Carregando eventos...</div>
         ) : processedData.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
               <Icons.Search className="w-12 h-12 text-zinc-800 mb-4" />
               <p className="text-zinc-500 font-bold">Nenhum log encontrado para este filtro.</p>
            </div>
         ) : (
            <div className="flex-1 p-4">
               {currentItems.map((item, index) => {
                  if ('type' in item && item.type === 'ROUND') {
                     return (
                       <RoundCard
                         key={item.id}
                         group={item as RoundGroup}
                         onQuickIgnore={handleQuickIgnore}
                       />
                     );
                  } else if ('type' in item && item.type === 'SESSION') {
                     return (
                       <SessionCard
                         key={item.id}
                         group={item as SessionGroup}
                         onQuickIgnore={handleQuickIgnore}
                       />
                     );
                  } else {
                     return (
                       <LogRow
                         key={(item as LogEntry).id}
                         log={item as LogEntry}
                         onQuickIgnore={handleQuickIgnore}
                       />
                     );
                  }
               })}
            </div>
         )}
         
         <Pagination 
            currentPage={currentPage}
            totalItems={processedData.length}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
         />
      </div>
    </div>
  );
};

export default Logs;
