(function () {
  var FALLBACKS = {
    tttloading: {
      slug: 'tttloading',
      name: 'TTT Loading',
      mode: 'TTT',
      enabled: true,
      routePath: '/tttloading',
      accentColor: '#be1b3c',
      backgroundImages: ['https://i.imgur.com/HnZfcKR.jpeg'],
      musicTracks: ['https://raw.githubusercontent.com/HanicBR/backtttloading/main/assets/music/gtavicecity.ogg'],
      hero: {
        badge: 'TTT',
        title: 'Trouble in Terrorist Town',
        subtitle: 'Quem e o assassino?',
        descriptionLines: [
          'Em TTT, paranoia e informacao decidem a rodada.',
          'Traidores: eliminem todos sem serem descobertos.',
          'Inocentes e detetive: identifiquem os traidores.',
        ],
      },
      notice: {
        title: 'Crash ao entrar?',
        lines: [
          'Se travar na entrada, faltam mapas da colecao.',
          'Abra o link, inscreva-se na colecao e tente novamente.',
        ],
        ctaLabel: 'Abrir colecao de mapas',
        ctaUrl: 'https://bit.ly/mapasback',
        qrImageUrl: 'https://i.imgur.com/5873D1j.jpeg',
      },
      rules: [
        'Nao mate sem motivo.',
        'Nao ofenda outros jogadores.',
        'Nao abuse de props para atrapalhar a rodada.',
        'Use !discord para entrar no Discord da rede.',
      ],
      vipTitle: 'Destaques da comunidade',
      vipPlayers: [
        {
          name: 'Mr.B-O-M-B-A-S-T-I-C',
          avatarUrl:
            'https://shared.akamai.steamstatic.com/community_assets/images/items/2181720/097978e42477d98190ed9e14e971c2b9976fc8d1.gif',
        },
      ],
    },
    sandboxloading: {
      slug: 'sandboxloading',
      name: 'Sandbox Loading',
      mode: 'SANDBOX',
      enabled: true,
      routePath: '/sandboxloading',
      accentColor: '#be1b3c',
      backgroundImages: ['https://i.imgur.com/HnZfcKR.jpeg'],
      musicTracks: ['https://raw.githubusercontent.com/HanicBR/backtttloading/main/assets/music/gtavicecity.ogg'],
      hero: {
        badge: 'SANDBOX',
        title: 'Backstabber Sandbox',
        subtitle: 'Construa, teste e jogue com liberdade',
        descriptionLines: [
          'Use Toolgun e Physgun para criar sem limites.',
          'Teste addons, armas, NPCs e sistemas do servidor.',
          'Respeite outras construcoes e evite grief.',
        ],
      },
      notice: {
        title: 'Erro ao entrar?',
        lines: [
          'Reinicie o jogo e tente novamente.',
          'Se persistir, limpe garrysmod/cache/lua e reabra o jogo.',
        ],
      },
      rules: [
        'Nao destrua construcoes de outros jogadores.',
        'Nao ofenda outros jogadores.',
        'Nao abuse de entidades para causar lag.',
        'Use !steam para entrar no grupo Steam.',
      ],
      vipTitle: 'Jogadores em destaque',
      vipPlayers: [
        {
          name: 'Sheva',
          avatarUrl: 'https://avatars.steamstatic.com/0650a97d7708b948a87e28c4b7c07ca9f268b073_full.jpg',
        },
      ],
    },
  };

  var state = {
    slug: '',
    profile: null,
    progress: 0,
    bgIndex: 0,
    bgTimer: null,
    audio: null,
    tracks: [],
    trackIndex: 0,
  };

  var isGmod = /GMod/i.test(navigator.userAgent || '');

  var dom = {
    bgLayer: document.getElementById('bg-layer'),
    heroBadge: document.getElementById('hero-badge'),
    heroTitle: document.getElementById('hero-title'),
    heroSubtitle: document.getElementById('hero-subtitle'),
    heroList: document.getElementById('hero-list'),
    noticeTitle: document.getElementById('notice-title'),
    noticeLines: document.getElementById('notice-lines'),
    noticeCta: document.getElementById('notice-cta'),
    noticeQrWrap: document.getElementById('notice-qr-wrap'),
    noticeQr: document.getElementById('notice-qr'),
    rulesList: document.getElementById('rules-list'),
    vipTitle: document.getElementById('vip-title'),
    vipList: document.getElementById('vip-list'),
    serverName: document.getElementById('server-name'),
    serverSub: document.getElementById('server-sub'),
    progressPercent: document.getElementById('progress-percent'),
    progressBar: document.getElementById('progress-bar'),
    statusText: document.getElementById('status-text'),
    fileText: document.getElementById('file-text'),
    infoMap: document.getElementById('info-map'),
    infoMode: document.getElementById('info-mode'),
  };

  function getSlug() {
    var fromGlobal = String(window.BSB_LOADING_SLUG || '').trim().toLowerCase();
    if (fromGlobal) return fromGlobal;

    var query = new URLSearchParams(window.location.search);
    var fromQuery = String(query.get('screen') || '').trim().toLowerCase();
    if (fromQuery) return fromQuery;

    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length > 0) return String(parts[parts.length - 1]).trim().toLowerCase();

    return 'tttloading';
  }

  function sanitizeColor(color) {
    return /^#[0-9a-f]{6}$/i.test(String(color || '').trim()) ? String(color) : '#be1b3c';
  }

  function safeLines(lines, fallback) {
    if (!Array.isArray(lines) || lines.length === 0) return fallback || [];
    return lines.map(function (item) {
      return String(item || '').trim();
    }).filter(Boolean);
  }

  function safePlayers(players) {
    if (!Array.isArray(players) || players.length === 0) return [];
    return players
      .map(function (item) {
        if (!item || typeof item !== 'object') return null;
        var name = String(item.name || '').trim();
        if (!name) return null;
        return {
          name: name,
          steamId: String(item.steamId || '').trim(),
          avatarUrl: String(item.avatarUrl || '').trim(),
          vipPlan: normalizeVipPlan(item.vipPlan),
        };
      })
      .filter(Boolean);
  }

  function normalizeVipPlan(value) {
    var raw = String(value || '').trim();
    if (!raw) return 'VIP';
    var upper = raw.toUpperCase();
    if (upper.indexOf('++') !== -1) return 'VIP++';
    if (upper.indexOf('+') !== -1) return 'VIP+';
    if (upper.indexOf('VIP') !== -1) return 'VIP';
    return raw.slice(0, 24);
  }

  function normalizeProfile(raw, fallback) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var base = fallback || FALLBACKS.tttloading;

    var slug = String(source.slug || base.slug || 'tttloading').trim().toLowerCase();
    var name = String(source.name || base.name || 'Backstabber Loading').trim();

    var hero = source.hero && typeof source.hero === 'object' ? source.hero : {};
    var notice = source.notice && typeof source.notice === 'object' ? source.notice : {};

    return {
      slug: slug,
      name: name,
      mode: String(source.mode || base.mode || 'CUSTOM'),
      enabled: source.enabled !== false,
      routePath: String(source.routePath || '/' + slug),
      accentColor: sanitizeColor(source.accentColor || base.accentColor),
      backgroundImages: safeLines(source.backgroundImages, base.backgroundImages),
      musicTracks: safeLines(source.musicTracks, base.musicTracks),
      hero: {
        badge: String(hero.badge || base.hero.badge || 'BACKSTABBER').trim(),
        title: String(hero.title || base.hero.title || 'Loading Screen').trim(),
        subtitle: String(hero.subtitle || base.hero.subtitle || '').trim(),
        descriptionLines: safeLines(hero.descriptionLines, base.hero.descriptionLines),
      },
      notice: {
        title: String(notice.title || base.notice.title || 'Avisos').trim(),
        lines: safeLines(notice.lines, base.notice.lines),
        ctaLabel: String(notice.ctaLabel || base.notice.ctaLabel || '').trim(),
        ctaUrl: String(notice.ctaUrl || base.notice.ctaUrl || '').trim(),
        qrImageUrl: String(notice.qrImageUrl || base.notice.qrImageUrl || '').trim(),
      },
      rules: safeLines(source.rules, base.rules),
      vipTitle: String(source.vipTitle || base.vipTitle || 'Destaques').trim(),
      vipPlayers: safePlayers(source.vipPlayers || base.vipPlayers),
    };
  }

  function setAccent(color) {
    document.documentElement.style.setProperty('--accent', sanitizeColor(color));
  }

  function renderLines(target, lines, ordered) {
    if (!target) return;
    target.innerHTML = '';

    (lines || []).forEach(function (line, index) {
      var item = document.createElement(ordered ? 'li' : 'div');
      if (ordered) {
        var marker = document.createElement('span');
        marker.className = 'rule-index';
        marker.textContent = String(index + 1);

        var text = document.createElement('span');
        text.textContent = String(line);

        item.appendChild(marker);
        item.appendChild(text);
      } else {
        item.textContent = String(line);
      }
      target.appendChild(item);
    });
  }

  function renderVips(title, players) {
    if (dom.vipTitle) dom.vipTitle.textContent = title || 'Destaques';
    if (!dom.vipList) return;

    dom.vipList.innerHTML = '';

    (players || []).forEach(function (player) {
      var wrap = document.createElement('div');
      wrap.className = 'vip-item';

      var avatar = document.createElement('img');
      avatar.className = 'vip-avatar';
      avatar.loading = 'lazy';
      avatar.alt = player.name || 'avatar';
      avatar.src =
        player.avatarUrl ||
        ('https://api.dicebear.com/7.x/bottts/svg?seed=' + encodeURIComponent(player.name || 'vip'));

      var info = document.createElement('div');
      info.style.minWidth = '0';
      var name = document.createElement('div');
      name.className = 'vip-name';
      name.textContent = player.name || 'Jogador';

      var steam = document.createElement('div');
      steam.className = 'vip-steam';
      steam.textContent = player.steamId || '';

      info.appendChild(name);
      info.appendChild(steam);

      var tier = document.createElement('span');
      var plan = normalizeVipPlan(player.vipPlan);
      tier.className = 'vip-tier';
      if (plan === 'VIP+') tier.className += ' vip-tier-plus';
      if (plan === 'VIP++') tier.className += ' vip-tier-plusplus';
      tier.textContent = plan;

      wrap.appendChild(avatar);
      wrap.appendChild(info);
      wrap.appendChild(tier);
      dom.vipList.appendChild(wrap);
    });
  }

  function applyProfile(profile) {
    state.profile = profile;

    setAccent(profile.accentColor);
    document.title = profile.name ? profile.name + ' - Loading' : 'Backstabber Loading';

    if (dom.heroBadge) dom.heroBadge.textContent = profile.hero.badge || profile.mode || 'BACK';
    if (dom.heroTitle) dom.heroTitle.textContent = profile.hero.title || profile.name;
    if (dom.heroSubtitle) dom.heroSubtitle.textContent = profile.hero.subtitle || 'Conectando...';

    renderLines(dom.heroList, profile.hero.descriptionLines, false);

    if (dom.noticeTitle) dom.noticeTitle.textContent = profile.notice.title || 'Aviso';
    renderLines(dom.noticeLines, profile.notice.lines, false);

    if (dom.noticeCta) {
      if (profile.notice.ctaLabel && profile.notice.ctaUrl) {
        dom.noticeCta.textContent = profile.notice.ctaLabel;
        dom.noticeCta.href = profile.notice.ctaUrl;
        dom.noticeCta.style.display = 'inline-flex';
      } else {
        dom.noticeCta.removeAttribute('href');
        dom.noticeCta.style.display = 'none';
      }
    }

    if (dom.noticeQrWrap && dom.noticeQr) {
      if (profile.notice.qrImageUrl) {
        dom.noticeQr.src = profile.notice.qrImageUrl;
        dom.noticeQrWrap.style.display = 'flex';
      } else {
        dom.noticeQr.removeAttribute('src');
        dom.noticeQrWrap.style.display = 'none';
      }
    }

    renderLines(dom.rulesList, profile.rules, true);
    renderVips(profile.vipTitle, profile.vipPlayers);

    startBackgroundRotation(profile.backgroundImages || []);
    initMusic(profile.musicTracks || []);

    if (dom.serverName) dom.serverName.textContent = profile.name || 'Backstabber Brasil';
    if (dom.serverSub) dom.serverSub.textContent = 'Conectando ao servidor...';

    if (dom.infoMode) dom.infoMode.textContent = 'modo: ' + (profile.mode || '-');
  }

  function startBackgroundRotation(images) {
    if (state.bgTimer) {
      window.clearInterval(state.bgTimer);
      state.bgTimer = null;
    }

    if (!dom.bgLayer) return;

    var list = (images || []).filter(Boolean);
    if (!list.length) {
      dom.bgLayer.style.backgroundImage = '';
      return;
    }

    state.bgIndex = 0;

    var apply = function () {
      dom.bgLayer.style.backgroundImage = 'url("' + list[state.bgIndex] + '")';
      state.bgIndex = (state.bgIndex + 1) % list.length;
    };

    apply();

    if (list.length > 1) {
      state.bgTimer = window.setInterval(apply, 12000);
    }
  }

  function initMusic(tracks) {
    var safeTracks = (tracks || []).filter(Boolean);
    state.tracks = safeTracks;
    state.trackIndex = 0;

    if (!safeTracks.length) {
      if (state.audio) {
        state.audio.pause();
      }
      return;
    }

    if (!state.audio) {
      state.audio = new Audio();
      state.audio.preload = 'auto';
      state.audio.volume = 0.25;
      state.audio.addEventListener('ended', function () {
        if (!state.tracks.length) return;
        state.trackIndex = (state.trackIndex + 1) % state.tracks.length;
        loadAndPlayTrack();
      });
    }

    function loadAndPlayTrack() {
      if (!state.audio || !state.tracks.length) return;
      state.audio.src = state.tracks[state.trackIndex];
      var promise = state.audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function () {
          // autoplay block; wait for gesture
        });
      }
    }

    var tryStart = function () {
      loadAndPlayTrack();
    };

    tryStart();

    if (!isGmod) {
      window.addEventListener('click', tryStart, { once: true });
      window.addEventListener('keydown', tryStart, { once: true });
      window.addEventListener('touchstart', tryStart, { once: true });
    }
  }

  function setProgress(target) {
    if (typeof target !== 'number' || Number.isNaN(target)) return;
    if (target < state.progress) target = state.progress;
    if (target > 100) target = 100;
    if (target < 0) target = 0;

    state.progress = target;

    if (dom.progressBar) {
      dom.progressBar.style.width = target.toFixed(2) + '%';
    }
    if (dom.progressPercent) {
      dom.progressPercent.textContent = Math.round(target) + '%';
    }

    if (target >= 99 && dom.serverSub) {
      dom.serverSub.textContent = 'Pronto para entrar!';
    }
  }

  function parseRatioProgress(status) {
    var text = String(status || '');
    var match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return null;

    var cur = parseInt(match[1], 10);
    var total = parseInt(match[2], 10);
    if (!Number.isFinite(cur) || !Number.isFinite(total) || total <= 0) return null;

    return 10 + (cur / total) * 75;
  }

  function GameDetails(servername, serverurl, mapname, maxplayers, steamid, gamemode) {
    if (dom.serverName) dom.serverName.textContent = String(servername || (state.profile && state.profile.name) || 'Backstabber Brasil');
    if (dom.serverSub) dom.serverSub.textContent = 'Conectando ao servidor...';
    if (dom.infoMap) dom.infoMap.textContent = 'mapa: ' + String(mapname || '-');
    if (dom.infoMode) dom.infoMode.textContent = 'modo: ' + String(gamemode || (state.profile && state.profile.mode) || '-');
  }

  function SetStatusChanged(status) {
    var text = String(status || '');
    if (dom.statusText) dom.statusText.textContent = text || 'Aguardando resposta do jogo...';

    var ratioProgress = parseRatioProgress(text);
    if (ratioProgress !== null) {
      setProgress(ratioProgress);
    }

    if (text === 'Workshop Complete' || text === 'Mounting Addons') {
      setProgress(82);
    }
    if (text === 'Client info sent!' || text === 'Client info sent') {
      setProgress(92);
    }
    if (text === 'Starting Lua...') {
      setProgress(100);
    }
  }

  function DownloadingFile(fileName) {
    if (dom.fileText) {
      var name = String(fileName || '').trim();
      dom.fileText.textContent = name ? 'Baixando: ' + name : '';
    }
  }

  function runPreview() {
    if (isGmod) return;

    GameDetails(
      (state.profile && state.profile.name) || 'Backstabber Brasil',
      '',
      state.profile && state.profile.mode === 'TTT' ? 'ttt_minecraft_b5' : 'gm_construct',
      32,
      '',
      (state.profile && state.profile.mode) || 'Sandbox'
    );

    var steps = [
      'Conectando ao servidor...',
      'Autenticando...',
      '2/20',
      '8/20',
      '15/20',
      '20/20',
      'Workshop Complete',
      'Client info sent!',
      'Starting Lua...',
    ];

    var i = 0;
    function tick() {
      if (i >= steps.length) return;
      SetStatusChanged(steps[i]);
      i += 1;
      window.setTimeout(tick, 900);
    }

    window.setTimeout(tick, 800);
  }

  async function fetchProfile(slug) {
    var fallback = FALLBACKS[slug] || FALLBACKS.tttloading;

    try {
      var response = await fetch('/api/loading-screens/public/' + encodeURIComponent(slug), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      var body = await response.json();
      return normalizeProfile(body, fallback);
    } catch (_err) {
      return normalizeProfile(fallback, FALLBACKS.tttloading);
    }
  }

  async function init() {
    state.slug = getSlug();
    var profile = await fetchProfile(state.slug);
    applyProfile(profile);

    if (dom.statusText) {
      dom.statusText.textContent = 'Aguardando resposta do jogo...';
    }

    window.GameDetails = GameDetails;
    window.SetStatusChanged = SetStatusChanged;
    window.DownloadingFile = DownloadingFile;

    runPreview();
  }

  init();
})();
