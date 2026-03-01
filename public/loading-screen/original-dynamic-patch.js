(function () {
  function getSlug() {
    var fromGlobal = String(window.BSB_LOADING_SLUG || '').trim().toLowerCase();
    if (fromGlobal) return fromGlobal;

    var query = new URLSearchParams(window.location.search);
    var querySlug = String(query.get('screen') || '').trim().toLowerCase();
    if (querySlug) return querySlug;

    var pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length) return String(pathParts[pathParts.length - 1]).toLowerCase();

    return 'tttloading';
  }

  function sanitizeSlug(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  }

  function hexToRgba(hex, alpha) {
    var safe = String(hex || '').replace('#', '');
    if (safe.length !== 6) return 'rgba(190,27,60,' + alpha + ')';
    var r = parseInt(safe.substring(0, 2), 16);
    var g = parseInt(safe.substring(2, 4), 16);
    var b = parseInt(safe.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function safeArray(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(function (item) {
        return String(item || '').trim();
      })
      .filter(Boolean);
  }

  function safePlayers(value) {
    if (!Array.isArray(value)) return [];
    return value
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

  function setText(selector, text) {
    var el = document.querySelector(selector);
    if (!el) return;
    el.textContent = String(text || '');
  }

  function setHtml(selector, html) {
    var el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = html;
  }

  function applyAccent(color) {
    if (!isHexColor(color)) return;
    document.documentElement.style.setProperty('--red', color);
    document.documentElement.style.setProperty('--red-soft', hexToRgba(color, 0.1));
  }

  function applyHero(hero) {
    if (!hero || typeof hero !== 'object') return;

    setText('.ttt-badge', hero.badge || 'BACK');

    var header = document.querySelector('.card-ttt .ttt-header');
    if (header) {
      var titleTarget = header.querySelector('span:not(.ttt-badge)');
      if (titleTarget) {
        titleTarget.textContent = String(hero.title || 'Loading');
      }
    }

    setText('.card-ttt .ttt-subtitle', hero.subtitle || 'Conectando...');

    var lines = safeArray(hero.descriptionLines);
    if (lines.length > 0) {
      var html = lines
        .map(function (line) {
          return '<div class="role-line">' + escapeHtml(line) + '</div>';
        })
        .join('');
      setHtml('.card-ttt .ttt-text', html);
    }
  }

  function applyNotice(notice) {
    if (!notice || typeof notice !== 'object') return;

    var lines = safeArray(notice.lines);
    var ctaLabel = String(notice.ctaLabel || '').trim();
    var ctaUrl = String(notice.ctaUrl || '').trim();
    var qrImageUrl = String(notice.qrImageUrl || '').trim();

    if (document.querySelector('.maps-fix-card')) {
      setText('.maps-fix-title', notice.title || 'Aviso');
      if (lines.length > 0) {
        setHtml(
          '.maps-fix-text',
          lines
            .map(function (line) {
              return '<div>' + escapeHtml(line) + '</div>';
            })
            .join('')
        );
      }

      var link = document.querySelector('.maps-fix-linkbig');
      if (link) {
        if (ctaLabel && ctaUrl) {
          link.textContent = ctaLabel;
          link.setAttribute('href', ctaUrl);
          link.style.display = 'block';
        } else {
          link.style.display = 'none';
        }
      }

      var hint = document.querySelector('.maps-fix-hint');
      if (hint) {
        if (lines.length > 1) {
          hint.textContent = lines[1];
        } else {
          hint.style.display = 'none';
        }
      }

      var qrWrap = document.querySelector('.maps-fix-qrwrap');
      var qrImg = document.querySelector('.maps-fix-qrwrap img');
      if (qrWrap && qrImg) {
        if (qrImageUrl) {
          qrImg.setAttribute('src', qrImageUrl);
          qrWrap.style.display = '';
        } else {
          qrWrap.style.display = 'none';
        }
      }
      return;
    }

    setText('.vip-club-title', notice.title || 'Aviso');
    var sandboxText = document.querySelector('.vip-club-text');
    if (sandboxText) {
      var textHtml = lines
        .map(function (line) {
          return '<div>' + escapeHtml(line) + '</div>';
        })
        .join('<br>');

      if (ctaLabel && ctaUrl) {
        textHtml +=
          '<br><br><a href="' +
          escapeAttr(ctaUrl) +
          '" target="_blank" rel="noreferrer" style="font-weight:900;color:#be1b3c;text-decoration:underline;">' +
          escapeHtml(ctaLabel) +
          '</a>';
      }

      sandboxText.innerHTML = textHtml;
    }
  }

  function applyRules(rules) {
    var list = document.querySelector('.card-rules .rules-list');
    if (!list) return;

    var items = safeArray(rules);
    if (!items.length) return;

    list.innerHTML = '';
    items.forEach(function (rule, index) {
      var row = document.createElement('div');
      row.className = 'rule-item';

      var num = document.createElement('div');
      num.className = 'rule-num';
      num.textContent = String(index + 1);

      var text = document.createElement('div');
      text.textContent = rule;

      row.appendChild(num);
      row.appendChild(text);
      list.appendChild(row);
    });
  }

  function renderVipFallback(players) {
    var list = document.querySelector('.vip-list');
    if (!list) return;

    list.innerHTML = '';
    players.forEach(function (player) {
      var row = document.createElement('div');
      row.className = 'vip-card';

      var avatar = document.createElement('img');
      avatar.className = 'vip-avatar';
      avatar.alt = player.name;
      avatar.src =
        player.avatarUrl ||
        'https://api.dicebear.com/7.x/bottts/svg?seed=' + encodeURIComponent(player.name || 'vip');

      var textWrap = document.createElement('div');
      textWrap.style.minWidth = '0';
      var name = document.createElement('div');
      name.className = 'vip-name rainbow-text';
      name.textContent = player.name;

      var steam = document.createElement('div');
      steam.className = 'vip-id';
      steam.textContent = player.steamId || '';

      textWrap.appendChild(name);
      textWrap.appendChild(steam);

      var tier = document.createElement('span');
      tier.className = 'bsb-vip-tier';
      var plan = normalizeVipPlan(player.vipPlan);
      if (plan === 'VIP+') tier.className += ' bsb-vip-tier--plus';
      if (plan === 'VIP++') tier.className += ' bsb-vip-tier--plusplus';
      tier.textContent = plan;

      row.appendChild(avatar);
      row.appendChild(textWrap);
      row.appendChild(tier);
      list.appendChild(row);
    });
  }

  function ensureVipTierStyles() {
    if (document.getElementById('bsb-vip-tier-style')) return;
    var style = document.createElement('style');
    style.id = 'bsb-vip-tier-style';
    style.textContent =
      '.bsb-vip-tier{margin-left:8px;display:inline-flex;align-items:center;justify-content:center;min-width:56px;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;border:1px solid rgba(15,23,42,.18);background:rgba(15,23,42,.06);color:#0f172a;white-space:nowrap}' +
      '.bsb-vip-tier--plus{background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.35);color:#1e3a8a}' +
      '.bsb-vip-tier--plusplus{background:rgba(234,179,8,.16);border-color:rgba(234,179,8,.4);color:#854d0e}';
    document.head.appendChild(style);
  }

  function decorateVipCardsFromList(mappedPlayers) {
    ensureVipTierStyles();
    var list = document.querySelector('.vip-list');
    if (!list) return;
    var cards = list.querySelectorAll('.vip-card');
    if (!cards || !cards.length) return;

    Array.prototype.forEach.call(cards, function (card, index) {
      var player = mappedPlayers[index];
      if (!player) return;

      card.style.display = 'grid';
      card.style.gridTemplateColumns = '40px minmax(0,1fr) auto';
      card.style.alignItems = 'center';
      card.style.columnGap = '10px';

      var infoWrap = card.children && card.children[1];
      if (infoWrap && infoWrap.style) {
        infoWrap.style.minWidth = '0';
        infoWrap.style.textAlign = 'left';
      }

      var existing = card.querySelector('.bsb-vip-tier');
      if (existing) existing.remove();

      var tier = normalizeVipPlan(player.vipPlan);
      var badge = document.createElement('span');
      badge.className = 'bsb-vip-tier';
      if (tier === 'VIP+') badge.className += ' bsb-vip-tier--plus';
      if (tier === 'VIP++') badge.className += ' bsb-vip-tier--plusplus';
      badge.textContent = tier;
      card.appendChild(badge);
    });
  }

  function applyVip(vipTitle, players) {
    setText('.vip-title', vipTitle || 'Jogadores em destaque');

    var mapped = players.map(function (entry) {
      return {
        steamId: entry.steamId || '',
        name: entry.name,
        avatar: entry.avatarUrl || '',
        vipPlan: normalizeVipPlan(entry.vipPlan),
      };
    });

    if (Array.isArray(window.VIPS)) {
      window.VIPS.length = 0;
      mapped.forEach(function (entry) {
        window.VIPS.push(entry);
      });
    } else {
      window.VIPS = mapped;
    }

    if (typeof window.renderVips === 'function') {
      window.renderVips();
      decorateVipCardsFromList(mapped);
      return;
    }

    renderVipFallback(players);
  }

  function applyBackground(backgroundImages) {
    var images = safeArray(backgroundImages);
    if (!images.length) return;

    if (window.LOADING_CONFIG && typeof window.LOADING_CONFIG === 'object') {
      window.LOADING_CONFIG.backgroundImages = images;
    }

    var layer = document.getElementById('bg-layer');
    if (layer) {
      layer.style.backgroundImage = "url('" + images[0] + "')";
    }

    var bgImg = document.getElementById('bg-img');
    if (bgImg) {
      bgImg.setAttribute('src', images[0]);
    }

    if (window.__bsbBgRotateTimer) {
      clearInterval(window.__bsbBgRotateTimer);
      window.__bsbBgRotateTimer = null;
    }

    if (images.length > 1) {
      var idx = 0;
      window.__bsbBgRotateTimer = setInterval(function () {
        idx = (idx + 1) % images.length;
        if (layer) {
          layer.style.backgroundImage = "url('" + images[idx] + "')";
        }
        if (bgImg) {
          bgImg.setAttribute('src', images[idx]);
        }
      }, 12000);
    }
  }

  function applyMusic(musicTracks) {
    var tracks = safeArray(musicTracks);
    if (!tracks.length) return;

    var audio = document.getElementById('bg-music');
    if (!audio) return;

    audio.innerHTML = '';
    tracks.forEach(function (track) {
      var source = document.createElement('source');
      source.setAttribute('src', track);
      if (track.toLowerCase().endsWith('.ogg')) source.setAttribute('type', 'audio/ogg');
      if (track.toLowerCase().endsWith('.mp3')) source.setAttribute('type', 'audio/mpeg');
      audio.appendChild(source);
    });

    var trackIndex = 0;
    audio.load();

    audio.onended = function () {
      if (!tracks.length) return;
      trackIndex = (trackIndex + 1) % tracks.length;
      audio.src = tracks[trackIndex];
      var p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    };

    var play = function () {
      if (!tracks.length) return;
      audio.src = tracks[trackIndex];
      var promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function () {});
      }
    };

    play();
    window.addEventListener('click', play, { once: true });
    window.addEventListener('keydown', play, { once: true });
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(text) {
    return escapeHtml(text);
  }

  function normalizeProfile(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      accentColor: String(source.accentColor || ''),
      backgroundImages: safeArray(source.backgroundImages),
      musicTracks: safeArray(source.musicTracks),
      hero: source.hero && typeof source.hero === 'object' ? source.hero : {},
      notice: source.notice && typeof source.notice === 'object' ? source.notice : {},
      rules: safeArray(source.rules),
      vipTitle: String(source.vipTitle || ''),
      vipPlayers: safePlayers(source.vipPlayers),
    };
  }

  function applyProfile(profile) {
    applyAccent(profile.accentColor);
    applyHero(profile.hero);
    applyNotice(profile.notice);
    applyRules(profile.rules);
    applyVip(profile.vipTitle, profile.vipPlayers);
    applyBackground(profile.backgroundImages);
    applyMusic(profile.musicTracks);
  }

  async function fetchAndApply() {
    var slug = sanitizeSlug(getSlug());
    if (!slug) return;

    try {
      var response = await fetch('/api/loading-screens/public/' + encodeURIComponent(slug), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) return;
      var json = await response.json();
      var profile = normalizeProfile(json);
      applyProfile(profile);
    } catch (_err) {
      // keep template defaults when API is not reachable
    }
  }

  fetchAndApply();
})();
