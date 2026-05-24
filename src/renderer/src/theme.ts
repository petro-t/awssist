import { useEffect } from 'react';
import { create } from 'zustand';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
  setResolved: (r: ResolvedTheme) => void;
}

const STORAGE_KEY = 'awssist.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

export const useTheme = create<ThemeState>((set) => ({
  pref: readPref(),
  resolved: resolve(readPref()),
  setPref(p) {
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
    set({ pref: p, resolved: resolve(p) });
  },
  setResolved(r) {
    set({ resolved: r });
  },
}));

/**
 * Mount-once hook: applies the resolved theme to <html>, listens for OS
 * dark-mode changes when the user has picked "system".
 */
export function useThemeBootstrap(): void {
  const pref = useTheme((s) => s.pref);
  const resolved = useTheme((s) => s.resolved);
  const setResolved = useTheme((s) => s.setResolved);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(resolved === 'dark' ? 'theme-dark' : 'theme-light');
    // Tailwind dark variant
    root.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  useEffect(() => {
    if (pref !== 'system' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setResolved(mql.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [pref, setResolved]);
}
