
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

// Helper to darken/lighten hex color
const adjustColor = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ApiService.getSiteConfig().then((data) => {
      setConfig(data);
      updateCssVariables(data.general.primaryColor);
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
    await ApiService.updateSiteConfig(newConfig);
    setConfig(newConfig);
    updateCssVariables(newConfig.general.primaryColor);
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
