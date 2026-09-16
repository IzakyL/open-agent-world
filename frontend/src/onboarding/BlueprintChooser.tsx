import { Bot, Code2, Layers3, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiErrorMessage, worldApi } from '../api/client';
import { t, useLocale } from '../i18n';
import { useWorldStore } from '../state/worldStore';
import type { LegionSummary } from '../types/world';
import { tutorial, useTutorialStore } from './controller';

const icons = { assistant: Bot, coding: Code2, team: Users };

export function BlueprintChooser() {
  useLocale();
  const [presets, setPresets] = useState<LegionSummary[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const saved = useWorldStore(s => s.legions);
  const offline = useWorldStore(s => s.syncState === 'offline');
  const busy = useTutorialStore(s => s.busy);
  useEffect(() => {
    let active = true;
    setError('');
    worldApi.getBlueprintPresets().then(items => { if (active) setPresets(items); })
      .catch(e => { if (active) setError(apiErrorMessage(e)); });
    return () => { active = false; };
  }, [retry]);
  const deploy = (blueprint: LegionSummary, preset: boolean) => void tutorial.fromBlueprint(blueprint, preset);
  return <div className="blueprint-chooser">
    <h2>{t('What would you like to do here?')}</h2>
    <p>{t('Choose a starting blueprint. You can change every card and connection.')}</p>
    <div className="blueprint-grid">
      {presets.map(item => {
        const Icon = icons[item.id as keyof typeof icons] ?? Layers3;
        return <button key={item.id} className="blueprint-option" disabled={busy || offline || !item.compatible}
          title={item.compatible ? undefined : item.issues.join(' ')} onClick={() => deploy(item, true)}>
          <Icon size={21} /><strong>{t(item.name)}</strong><span>{t(item.description ?? '')}</span>
        </button>;
      })}
    </div>
    {!presets.length && !error && <p role="status">{t('Loading blueprints…')}</p>}
    {error && <p className="onboarding-error" role="alert">{error} <button className="onboarding-text-button" onClick={() => setRetry(v => v + 1)}>{t('Retry')}</button></p>}
    {saved.length > 0 && <details className="blueprint-saved"><summary>{t('Use a saved Legion as a blueprint')}</summary>
      <p>{t('Only the nodes and connections are placed. Shared Legion settings stay in the saved template.')}</p>
      {saved.map(item => <button key={item.id} className="secondary-button" disabled={busy || offline || !item.compatible}
        title={item.issues.join(' ')} onClick={() => deploy(item, false)}><Layers3 size={14} />{item.name}</button>)}
    </details>}
  </div>;
}
