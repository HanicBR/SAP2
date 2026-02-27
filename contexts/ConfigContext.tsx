
import React, { createContext, useContext, useEffect, useState } from 'react';
import { SiteConfig } from '../types';
import { DEFAULT_SITE_CONFIG } from '../constants';
import { ApiService } from '../services/api';

interface ConfigContextType {
  config: SiteConfig;
  updateConfig: (newConfig: SiteConfig) => Promise<void>;
  loading: boolean;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

const toArrayOrFallback = <T,>(value: unknown, fallback: T[]): T[] =>
  Array.isArray(value) && value.length > 0 ? (value as T[]) : fallback;

const normalizeSiteConfig = (raw?: Partial<SiteConfig>): SiteConfig => {
  const next = (raw || {}) as Partial<SiteConfig>;
  const nextVip = (next.vip || {}) as Partial<SiteConfig['vip']>;
  const nextVipAutomation = next.vipAutomation;
  const defaultVip = DEFAULT_SITE_CONFIG.vip;

  return {
    ...DEFAULT_SITE_CONFIG,
    ...next,
    general: {
      ...DEFAULT_SITE_CONFIG.general,
      ...(next.general || {}),
    },
    social: {
      ...DEFAULT_SITE_CONFIG.social,
      ...(next.social || {}),
    },
    home: {
      ...DEFAULT_SITE_CONFIG.home,
      ...(next.home || {}),
      heroSubtitleSegments: toArrayOrFallback(next.home?.heroSubtitleSegments, DEFAULT_SITE_CONFIG.home.heroSubtitleSegments),
    },
    vip: {
      ...defaultVip,
      ...nextVip,
      plans: toArrayOrFallback(nextVip.plans, defaultVip.plans),
      billingOptions: toArrayOrFallback(nextVip.billingOptions, defaultVip.billingOptions),
      ultimatePlan: {
        ...defaultVip.ultimatePlan,
        ...(nextVip.ultimatePlan || {}),
        benefits: toArrayOrFallback(nextVip.ultimatePlan?.benefits, defaultVip.ultimatePlan.benefits),
      },
      payment: {
        ...defaultVip.payment,
        ...(nextVip.payment || {}),
      },
      faq: toArrayOrFallback(nextVip.faq, defaultVip.faq),
    },
    logs: {
      ...(DEFAULT_SITE_CONFIG.logs || {}),
      ...(next.logs || {}),
    },
    ...(nextVipAutomation
      ? {
          vipAutomation: {
            enabled: nextVipAutomation.enabled === true,
            ...(String(nextVipAutomation.sandboxServerId || '').trim()
              ? { sandboxServerId: String(nextVipAutomation.sandboxServerId || '').trim() }
              : {}),
            grantTemplate: String(nextVipAutomation.grantTemplate || '').trim(),
            revokeTemplate: String(nextVipAutomation.revokeTemplate || '').trim(),
          },
        }
      : {}),
  };
};

// Helper to darken/lighten hex color
const adjustColor = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ApiService.getSiteConfig().then((data) => {
      const normalized = normalizeSiteConfig(data);
      setConfig(normalized);
      updateCssVariables(normalized.general.primaryColor);
      setLoading(false);
    });
  }, []);

  const updateCssVariables = (hexColor: string) => {
    const root = document.documentElement;
    root.style.setProperty('--brand-color', hexColor);
    // Approximate shades for hover/light/dark
    // Simple heuristic: Darken for hover/dark, lighten for light
    // Note: A real robust system would use hsl or dedicated library
    // For this MVP, we rely on the hex color being standard.
    // If user provides something weird, it might look off.
    root.style.setProperty('--brand-color-hover', adjustColor(hexColor, -20));
    root.style.setProperty('--brand-color-dark', adjustColor(hexColor, -60));
    root.style.setProperty('--brand-color-light', adjustColor(hexColor, 40));
  };

  const updateConfig = async (newConfig: SiteConfig) => {
    const normalized = normalizeSiteConfig(newConfig);
    await ApiService.updateSiteConfig(normalized);
    setConfig(normalized);
    updateCssVariables(normalized.general.primaryColor);
  };

  return (
    <ConfigContext.Provider value={{ config, updateConfig, loading }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
