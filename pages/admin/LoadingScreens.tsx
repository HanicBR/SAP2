import React, { useEffect, useMemo, useState } from 'react';
import { Icons } from '../../components/Icon';
import { ApiService } from '../../services/api';
import { LoadingScreenMode, LoadingScreenProfile, LoadingScreenVipEntry } from '../../types';

type NoticeTone = 'success' | 'error' | 'info';

type Notice = {
  tone: NoticeTone;
  message: string;
};

const INPUT_CLASS =
  'w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-600 focus:outline-none';
const TEXTAREA_CLASS =
  'w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-600 focus:outline-none';
const LABEL_CLASS = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500';
const CARD_CLASS = 'rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 md:p-5';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const nowIso = (): string => new Date().toISOString();

const normalizeSlug = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const toLineInput = (items: string[] | undefined): string => (items || []).join('\n');

const parseLineInput = (value: string): string[] =>
  Array.from(
    new Set(
      String(value || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const makeVip = (): LoadingScreenVipEntry => ({
  name: 'Novo destaque',
  steamId: '',
  avatarUrl: '',
});

const makeDraft = (base?: LoadingScreenProfile): LoadingScreenProfile => {
  const slug = base?.slug || `loading-${Date.now()}`;
  return {
    slug,
    name: base?.name || 'Nova loading screen',
    mode: base?.mode || 'CUSTOM',
    enabled: base?.enabled ?? true,
    routePath: `/${slug}`,
    accentColor: base?.accentColor || '#be1b3c',
    backgroundImages: base?.backgroundImages?.length
      ? [...base.backgroundImages]
      : ['https://i.imgur.com/HnZfcKR.jpeg'],
    musicTracks: base?.musicTracks?.length ? [...base.musicTracks] : [],
    hero: {
      badge: base?.hero.badge || 'BACKSTABBER',
      title: base?.hero.title || 'Loading Screen',
      subtitle: base?.hero.subtitle || 'Conectando ao servidor',
      descriptionLines: base?.hero.descriptionLines?.length
        ? [...base.hero.descriptionLines]
        : ['Descreva aqui a experiencia principal dessa loading screen.'],
    },
    notice: {
      title: base?.notice.title || 'Avisos importantes',
      lines: base?.notice.lines?.length ? [...base.notice.lines] : ['Adicione instrucoes ou links de suporte.'],
      ...(base?.notice.ctaLabel ? { ctaLabel: base.notice.ctaLabel } : {}),
      ...(base?.notice.ctaUrl ? { ctaUrl: base.notice.ctaUrl } : {}),
      ...(base?.notice.qrImageUrl ? { qrImageUrl: base.notice.qrImageUrl } : {}),
    },
    rules: base?.rules?.length ? [...base.rules] : ['Regra 1', 'Regra 2', 'Regra 3'],
    vipTitle: base?.vipTitle || 'Destaques da comunidade',
    vipPlayers: base?.vipPlayers?.length ? clone(base.vipPlayers) : [makeVip()],
    updatedAt: nowIso(),
  };
};

const noticeClass = (tone: NoticeTone): string => {
  if (tone === 'success') return 'border-emerald-900/40 bg-emerald-900/10 text-emerald-300';
  if (tone === 'error') return 'border-red-900/40 bg-red-900/10 text-red-300';
  return 'border-cyan-900/40 bg-cyan-900/10 text-cyan-300';
};

const sortProfiles = (profiles: LoadingScreenProfile[]): LoadingScreenProfile[] =>
  [...profiles].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

const isClassicRoute = (slug: string): boolean => slug === 'tttloading' || slug === 'sandboxloading';

const buildPublicUrl = (slug: string): string => {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) return '';
  const origin = window.location.origin;
  if (safeSlug === 'tttloading') return `${origin}/tttloading/`;
  if (safeSlug === 'sandboxloading') return `${origin}/sandboxloading/`;
  return `${origin}/loading/?screen=${encodeURIComponent(safeSlug)}`;
};

const LoadingScreens: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [profiles, setProfiles] = useState<LoadingScreenProfile[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [draft, setDraft] = useState<LoadingScreenProfile | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [savedSignature, setSavedSignature] = useState('');

  const [bgInput, setBgInput] = useState('');
  const [musicInput, setMusicInput] = useState('');
  const [heroDescInput, setHeroDescInput] = useState('');
  const [noticeLinesInput, setNoticeLinesInput] = useState('');
  const [rulesInput, setRulesInput] = useState('');
  const [activeEditorTab, setActiveEditorTab] = useState<'identity' | 'content' | 'media' | 'vip'>(
    'identity',
  );

  const hydrateDraftInputs = (profile: LoadingScreenProfile) => {
    setBgInput(toLineInput(profile.backgroundImages));
    setMusicInput(toLineInput(profile.musicTracks));
    setHeroDescInput(toLineInput(profile.hero.descriptionLines));
    setNoticeLinesInput(toLineInput(profile.notice.lines));
    setRulesInput(toLineInput(profile.rules));
  };

  const applyDraft = (profile: LoadingScreenProfile, nextIsNew = false) => {
    const normalized = makeDraft(profile);
    setDraft(normalized);
    setSelectedSlug(normalized.slug);
    setIsNewDraft(nextIsNew);
    hydrateDraftInputs(normalized);
    const signature = JSON.stringify(normalized);
    setSavedSignature(signature);
  };

  const loadProfiles = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const result = await ApiService.getLoadingScreens();
      const sorted = sortProfiles(result.profiles || []);
      setProfiles(sorted);
      const initial = sorted[0];
      if (initial) {
        applyDraft(initial, false);
      } else {
        const fresh = makeDraft();
        setProfiles([fresh]);
        applyDraft(fresh, true);
      }
    } catch (error: any) {
      setNotice({
        tone: 'error',
        message: error?.message ? String(error.message) : 'Falha ao carregar loading screens.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  const draftSignature = useMemo(() => JSON.stringify(draft), [draft]);
  const hasChanges = Boolean(draft) && draftSignature !== savedSignature;

  const updateDraft = (patch: Partial<LoadingScreenProfile>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        ...patch,
      };
      return next;
    });
  };

  const updateHero = (patch: Partial<LoadingScreenProfile['hero']>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hero: {
          ...prev.hero,
          ...patch,
        },
      };
    });
  };

  const updateNotice = (patch: Partial<LoadingScreenProfile['notice']>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextNotice: LoadingScreenProfile['notice'] = {
        ...prev.notice,
        ...patch,
      };
      if (!nextNotice.ctaLabel) delete nextNotice.ctaLabel;
      if (!nextNotice.ctaUrl) delete nextNotice.ctaUrl;
      if (!nextNotice.qrImageUrl) delete nextNotice.qrImageUrl;
      return {
        ...prev,
        notice: nextNotice,
      };
    });
  };

  const syncArrayInputsToDraft = () => {
    if (!draft) return draft;
    return {
      ...draft,
      backgroundImages: parseLineInput(bgInput),
      musicTracks: parseLineInput(musicInput),
      hero: {
        ...draft.hero,
        descriptionLines: parseLineInput(heroDescInput),
      },
      notice: {
        ...draft.notice,
        lines: parseLineInput(noticeLinesInput),
      },
      rules: parseLineInput(rulesInput),
    } as LoadingScreenProfile;
  };

  const selectProfile = (slug: string) => {
    const profile = profiles.find((entry) => entry.slug === slug);
    if (!profile) return;
    applyDraft(profile, false);
    setNotice(null);
  };

  const createNewProfile = () => {
    const base = draft ? clone(draft) : undefined;
    const fresh = makeDraft({
      ...(base || makeDraft()),
      slug: `loading-${Date.now()}`,
      name: 'Nova loading screen',
      mode: 'CUSTOM',
      routePath: '',
    });
    setProfiles((prev) => [fresh, ...prev]);
    setDraft(fresh);
    setSelectedSlug(fresh.slug);
    setIsNewDraft(true);
    hydrateDraftInputs(fresh);
    setSavedSignature('');
    setNotice({ tone: 'info', message: 'Nova loading screen criada localmente. Clique em salvar para persistir.' });
  };

  const duplicateCurrent = () => {
    if (!draft) return;
    const baseSlug = normalizeSlug(draft.slug || draft.name) || 'loading-copy';
    let nextSlug = `${baseSlug}-copy`;
    let suffix = 2;
    while (profiles.some((entry) => entry.slug === nextSlug)) {
      nextSlug = `${baseSlug}-copy-${suffix}`;
      suffix += 1;
    }

    const duplicated = makeDraft({
      ...clone(draft),
      slug: nextSlug,
      name: `${draft.name} (copia)`,
      routePath: `/${nextSlug}`,
      updatedAt: nowIso(),
    });

    setProfiles((prev) => [duplicated, ...prev]);
    setDraft(duplicated);
    setSelectedSlug(duplicated.slug);
    setIsNewDraft(true);
    hydrateDraftInputs(duplicated);
    setSavedSignature('');
    setNotice({ tone: 'info', message: 'Copia criada. Salve para publicar.' });
  };

  const discardChanges = () => {
    if (!draft) return;
    if (isNewDraft) {
      const remaining = profiles.filter((entry) => entry.slug !== draft.slug);
      setProfiles(remaining);
      const fallback = remaining[0];
      if (fallback) {
        applyDraft(fallback, false);
      } else {
        const fresh = makeDraft();
        setProfiles([fresh]);
        applyDraft(fresh, true);
      }
      setNotice({ tone: 'info', message: 'Rascunho novo descartado.' });
      return;
    }

    const source = profiles.find((entry) => entry.slug === selectedSlug);
    if (source) {
      applyDraft(source, false);
      setNotice({ tone: 'info', message: 'Alteracoes locais descartadas.' });
    }
  };

  const handleSave = async () => {
    if (!draft) return;

    const prepared = syncArrayInputsToDraft();
    if (!prepared) return;

    const safeSlug = normalizeSlug(prepared.slug);
    if (!safeSlug) {
      setNotice({ tone: 'error', message: 'Slug invalido. Use apenas letras, numeros e hifen.' });
      return;
    }

    const payload: LoadingScreenProfile = {
      ...prepared,
      slug: safeSlug,
      routePath: `/${safeSlug}`,
      updatedAt: nowIso(),
    };

    setSaving(true);
    setNotice(null);

    try {
      let result;
      if (isNewDraft) {
        result = await ApiService.createLoadingScreen(payload);
      } else {
        result = await ApiService.updateLoadingScreen(payload.slug, payload);
      }

      const sorted = sortProfiles(result.profiles || []);
      setProfiles(sorted);
      const fresh = sorted.find((entry) => entry.slug === payload.slug) || sorted[0];
      if (fresh) {
        applyDraft(fresh, false);
      }
      setIsNewDraft(false);
      setNotice({ tone: 'success', message: 'Loading screen salva com sucesso.' });
    } catch (error: any) {
      setNotice({
        tone: 'error',
        message: error?.message ? String(error.message) : 'Falha ao salvar loading screen.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft) return;

    if (isNewDraft) {
      const next = profiles.filter((entry) => entry.slug !== draft.slug);
      setProfiles(next);
      const fallback = next[0];
      if (fallback) {
        applyDraft(fallback, false);
      }
      setNotice({ tone: 'info', message: 'Rascunho removido.' });
      return;
    }

    if (!window.confirm(`Remover a loading screen "${draft.name}"?`)) {
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const result = await ApiService.deleteLoadingScreen(draft.slug);
      const sorted = sortProfiles(result.profiles || []);
      setProfiles(sorted);
      const fallback = sorted[0];
      if (fallback) {
        applyDraft(fallback, false);
      }
      setNotice({ tone: 'success', message: 'Loading screen removida.' });
    } catch (error: any) {
      setNotice({
        tone: 'error',
        message: error?.message ? String(error.message) : 'Falha ao remover loading screen.',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateVip = (index: number, patch: Partial<LoadingScreenVipEntry>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev.vipPlayers];
      next[index] = {
        ...next[index],
        ...patch,
      };
      return {
        ...prev,
        vipPlayers: next,
      };
    });
  };

  const addVip = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        vipPlayers: [...prev.vipPlayers, makeVip()],
      };
    });
  };

  const removeVip = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = prev.vipPlayers.filter((_, idx) => idx !== index);
      return {
        ...prev,
        vipPlayers: next.length ? next : [makeVip()],
      };
    });
  };

  const copyPublicUrl = async () => {
    if (!draft) return;
    const url = buildPublicUrl(draft.slug);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: 'success', message: 'URL copiada para a area de transferencia.' });
    } catch {
      setNotice({ tone: 'error', message: 'Nao foi possivel copiar a URL automaticamente.' });
    }
  };

  if (loading) {
    return <div className="p-8 text-zinc-500">Carregando loading screens...</div>;
  }

  if (!draft) {
    return <div className="p-8 text-zinc-500">Nenhuma loading screen encontrada.</div>;
  }

  const publicUrl = buildPublicUrl(draft.slug);

  return (
    <div className="space-y-5 animate-fade-in pb-24">
      <div className="rounded-2xl border border-red-900/30 bg-gradient-to-r from-red-950/45 via-zinc-900 to-cyan-950/35 p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="flex items-center text-2xl font-black text-white">
              <Icons.Image className="mr-3 h-6 w-6 text-red-400" />
              Telas de Loading
            </h1>
            <p className="mt-1 text-sm text-zinc-300">
              Configure conteudo, musicas e visual das loading screens publicas dos servidores.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-zinc-300">
                Perfis: {profiles.length}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  draft.enabled
                    ? 'border-emerald-800/60 bg-emerald-900/30 text-emerald-300'
                    : 'border-zinc-700 bg-zinc-900/70 text-zinc-400'
                }`}
              >
                Status atual: {draft.enabled ? 'Ativo' : 'Desativado'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={createNewProfile}
            className="rounded-lg border border-cyan-700/60 bg-cyan-900/25 px-3 py-2 text-xs font-bold uppercase text-cyan-200"
          >
            + Nova tela
          </button>
          <button
            type="button"
            onClick={duplicateCurrent}
            className="rounded-lg border border-violet-700/60 bg-violet-900/25 px-3 py-2 text-xs font-bold uppercase text-violet-200"
          >
            Duplicar
          </button>
          </div>
        </div>
      </div>

      {notice ? (
        <div className={`rounded border px-3 py-2 text-sm ${noticeClass(notice.tone)}`}>{notice.message}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/85 p-3 shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
            <h2 className="text-xs font-black uppercase tracking-wide text-zinc-300">Perfis</h2>
            <div className="mt-3 space-y-2">
              {profiles.map((profile) => (
                <button
                  key={profile.slug}
                  type="button"
                  onClick={() => selectProfile(profile.slug)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    selectedSlug === profile.slug
                      ? 'border-red-700 bg-red-900/25 text-red-100 shadow-[0_0_0_1px_rgba(185,28,28,0.25)]'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{profile.name}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        profile.enabled
                          ? 'bg-emerald-900/25 text-emerald-300'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {profile.enabled ? 'Ativa' : 'Off'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-zinc-500">/{profile.slug}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">{profile.mode}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/85 p-3 shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
            <h3 className="text-xs font-black uppercase tracking-wide text-zinc-300">URL publica</h3>
            <p className="mt-2 break-all rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
              {publicUrl || '---'}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={copyPublicUrl}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] font-bold uppercase text-zinc-200"
              >
                Copiar
              </button>
              <a
                href={publicUrl || '#'}
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-zinc-200"
              >
                Preview
              </a>
            </div>
            {!isClassicRoute(draft.slug) ? (
              <p className="mt-2 text-[11px] text-zinc-500">
                Slug custom usa rota fallback: <span className="font-mono">/loading/?screen=slug</span>
              </p>
            ) : null}
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/85 p-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => setActiveEditorTab('identity')}
                className={`flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                  activeEditorTab === 'identity'
                    ? 'border-red-700 bg-red-900/30 text-red-200'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                <Icons.Settings className="mr-2 h-4 w-4" />
                Identidade
              </button>
              <button
                type="button"
                onClick={() => setActiveEditorTab('content')}
                className={`flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                  activeEditorTab === 'content'
                    ? 'border-red-700 bg-red-900/30 text-red-200'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                <Icons.FileText className="mr-2 h-4 w-4" />
                Conteudo
              </button>
              <button
                type="button"
                onClick={() => setActiveEditorTab('media')}
                className={`flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                  activeEditorTab === 'media'
                    ? 'border-red-700 bg-red-900/30 text-red-200'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                <Icons.Image className="mr-2 h-4 w-4" />
                Midia
              </button>
              <button
                type="button"
                onClick={() => setActiveEditorTab('vip')}
                className={`flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                  activeEditorTab === 'vip'
                    ? 'border-red-700 bg-red-900/30 text-red-200'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                <Icons.Crown className="mr-2 h-4 w-4" />
                VIPs
              </button>
            </div>
          </div>
          {activeEditorTab === 'identity' ? (
            <div className={`${CARD_CLASS} border-red-900/25 bg-zinc-900/90`}>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">Identificacao</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className={LABEL_CLASS}>Nome</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Slug</label>
                <input
                  type="text"
                  value={draft.slug}
                  onChange={(event) => {
                    const slug = normalizeSlug(event.target.value);
                    updateDraft({ slug, routePath: `/${slug}` });
                  }}
                  disabled={!isNewDraft}
                  className={`${INPUT_CLASS} font-mono disabled:opacity-60`}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Modo</label>
                <select
                  value={draft.mode}
                  onChange={(event) => updateDraft({ mode: event.target.value as LoadingScreenMode })}
                  className={INPUT_CLASS}
                >
                  <option value="TTT">TTT</option>
                  <option value="SANDBOX">Sandbox</option>
                  <option value="MURDER">Murder</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>Cor destaque</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={draft.accentColor}
                    onChange={(event) => updateDraft({ accentColor: event.target.value })}
                    className="h-10 w-14 rounded border border-zinc-700 bg-zinc-950"
                  />
                  <input
                    type="text"
                    value={draft.accentColor}
                    onChange={(event) => updateDraft({ accentColor: event.target.value })}
                    className={`${INPUT_CLASS} font-mono uppercase`}
                  />
                </div>
              </div>
            </div>
            <label className="mt-3 inline-flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => updateDraft({ enabled: event.target.checked })}
              />
              Loading screen habilitada para uso publico
            </label>
            </div>
          ) : null}

          {activeEditorTab === 'content' ? (
            <div className={`${CARD_CLASS} border-cyan-900/25 bg-zinc-900/90`}>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">Hero</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <label className={LABEL_CLASS}>Badge</label>
                <input
                  type="text"
                  value={draft.hero.badge}
                  onChange={(event) => updateHero({ badge: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Titulo</label>
                <input
                  type="text"
                  value={draft.hero.title}
                  onChange={(event) => updateHero({ title: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Subtitulo</label>
                <input
                  type="text"
                  value={draft.hero.subtitle}
                  onChange={(event) => updateHero({ subtitle: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="mt-3">
              <label className={LABEL_CLASS}>Descricao (1 linha por item)</label>
              <textarea
                rows={4}
                value={heroDescInput}
                onChange={(event) => {
                  setHeroDescInput(event.target.value);
                  updateHero({ descriptionLines: parseLineInput(event.target.value) });
                }}
                className={TEXTAREA_CLASS}
              />
            </div>
            </div>
          ) : null}

          {activeEditorTab === 'content' ? (
            <div className={`${CARD_CLASS} border-amber-900/25 bg-zinc-900/90`}>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">Card de aviso</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <label className={LABEL_CLASS}>Titulo do aviso</label>
                <input
                  type="text"
                  value={draft.notice.title}
                  onChange={(event) => updateNotice({ title: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>CTA label (opcional)</label>
                <input
                  type="text"
                  value={draft.notice.ctaLabel || ''}
                  onChange={(event) => updateNotice({ ctaLabel: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>CTA URL (opcional)</label>
                <input
                  type="text"
                  value={draft.notice.ctaUrl || ''}
                  onChange={(event) => updateNotice({ ctaUrl: event.target.value })}
                  className={INPUT_CLASS}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>QR image URL (opcional)</label>
                <input
                  type="text"
                  value={draft.notice.qrImageUrl || ''}
                  onChange={(event) => updateNotice({ qrImageUrl: event.target.value })}
                  className={INPUT_CLASS}
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="mt-3">
              <label className={LABEL_CLASS}>Linhas do aviso</label>
              <textarea
                rows={4}
                value={noticeLinesInput}
                onChange={(event) => {
                  setNoticeLinesInput(event.target.value);
                  updateNotice({ lines: parseLineInput(event.target.value) });
                }}
                className={TEXTAREA_CLASS}
              />
            </div>
            </div>
          ) : null}

          {activeEditorTab === 'content' ? (
            <div className={`${CARD_CLASS} border-violet-900/25 bg-zinc-900/90`}>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">Regras / dicas</h3>
            <label className={`${LABEL_CLASS} mt-4`}>Uma linha por item</label>
            <textarea
              rows={5}
              value={rulesInput}
              onChange={(event) => {
                setRulesInput(event.target.value);
                updateDraft({ rules: parseLineInput(event.target.value) });
              }}
                className={TEXTAREA_CLASS}
              />
            </div>
          ) : null}

          {activeEditorTab === 'media' ? (
            <div className={`${CARD_CLASS} border-emerald-900/25 bg-zinc-900/90`}>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">Media</h3>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div>
                <label className={LABEL_CLASS}>Background images (uma URL por linha)</label>
                <textarea
                  rows={5}
                  value={bgInput}
                  onChange={(event) => {
                    setBgInput(event.target.value);
                    updateDraft({ backgroundImages: parseLineInput(event.target.value) });
                  }}
                  className={TEXTAREA_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Playlist (uma URL por linha)</label>
                <textarea
                  rows={5}
                  value={musicInput}
                  onChange={(event) => {
                    setMusicInput(event.target.value);
                    updateDraft({ musicTracks: parseLineInput(event.target.value) });
                  }}
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>
            </div>
          ) : null}

          {activeEditorTab === 'vip' ? (
            <div className={`${CARD_CLASS} border-fuchsia-900/25 bg-zinc-900/90`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black uppercase tracking-wide text-white">Destaques/VIPs exibidos</h3>
              <button
                type="button"
                onClick={addVip}
                className="rounded border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-bold uppercase text-zinc-200"
              >
                + VIP
              </button>
            </div>

            <div className="mt-3">
              <label className={LABEL_CLASS}>Titulo da secao</label>
              <input
                type="text"
                value={draft.vipTitle}
                onChange={(event) => updateDraft({ vipTitle: event.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div className="mt-3 space-y-2">
              {draft.vipPlayers.map((vip, index) => (
                <div key={`${vip.name}-${index}`} className="grid gap-2 rounded border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-12">
                  <div className="md:col-span-4">
                    <label className={LABEL_CLASS}>Nome</label>
                    <input
                      type="text"
                      value={vip.name}
                      onChange={(event) => updateVip(index, { name: event.target.value })}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className={LABEL_CLASS}>SteamID (opcional)</label>
                    <input
                      type="text"
                      value={vip.steamId || ''}
                      onChange={(event) => updateVip(index, { steamId: event.target.value })}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className={LABEL_CLASS}>Avatar URL</label>
                    <input
                      type="text"
                      value={vip.avatarUrl || ''}
                      onChange={(event) => updateVip(index, { avatarUrl: event.target.value })}
                      className={INPUT_CLASS}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="md:col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeVip(index)}
                      className="h-10 w-10 rounded border border-red-900/60 bg-red-900/20 text-red-300"
                    >
                      <Icons.Trash className="mx-auto h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </div>
          ) : null}
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={discardChanges}
            disabled={!hasChanges || saving}
            className="rounded border border-zinc-700 px-4 py-2 text-xs font-bold uppercase text-zinc-300 disabled:opacity-40"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="rounded border border-red-900/60 bg-red-900/20 px-4 py-2 text-xs font-bold uppercase text-red-300 disabled:opacity-40"
          >
            Remover
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!hasChanges || saving}
            className="rounded border border-red-800 bg-red-900/25 px-5 py-2 text-xs font-bold uppercase text-red-200 disabled:opacity-40"
          >
            {saving ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreens;
