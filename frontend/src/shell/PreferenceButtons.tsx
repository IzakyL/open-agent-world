import { Languages, Moon, Settings2, Sun } from 'lucide-react';
import { t, useLocale } from '../i18n';
import { useWorldStore } from '../state/worldStore';

export function SettingsButton() {
  useLocale();
  const toggleSettings = useWorldStore(state => state.toggleSettings);
  return (
    <button type="button" className="top-icon-button" onClick={toggleSettings} data-tutorial="settings" aria-label={t("Open settings")} title={t("Settings")}>
      <Settings2 size={16} />
    </button>
  );
}

export function AppearanceButtons() {
  const { locale, setLocale } = useLocale();
  const theme = useWorldStore(state => state.theme);
  const toggleTheme = useWorldStore(state => state.toggleTheme);
  return <>
    <button
      type="button"
      className="top-icon-button"
      onClick={toggleTheme}
      aria-label={t(theme === "light" ? "Use dark theme" : "Use light theme")}
      title={t(theme === "light" ? "Use dark theme" : "Use light theme")}
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
    <button type="button" className="top-icon-button" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')} aria-label={locale === 'en' ? '切换到中文' : 'Switch to English'} title={locale === 'en' ? '切换到中文' : 'Switch to English'}><Languages size={16} /></button>
  </>;
}
