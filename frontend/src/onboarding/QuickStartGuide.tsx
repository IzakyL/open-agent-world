import { t, useLocale } from '../i18n';
import { useWorldStore } from '../state/worldStore';
import { useNodeSurfaceStore } from '../state/nodeSurfaces';
import { hasModelConfiguration } from '../state/modelConnections';
import { useTutorialStore } from './controller';

export function QuickStartGuide() {
  useLocale();
  const setup = useTutorialStore(s => s.quickStart);
  const cards = useWorldStore(s => s.cards);
  const models = useWorldStore(s => s.modelCatalog);
  const agent = cards.find(card => card.id === setup?.agentId);
  if (!setup || !agent) return null;
  const needsModel = agent.type === 'agent' && !hasModelConfiguration(models, agent.config.model);
  return <section className="quick-start-guide" aria-label={t('Quick Start setup')}>
    <strong>{t(needsModel ? 'Connect a model to start chatting' : 'Your first workspace')}</strong>
    <p>{t(needsModel ? 'Your Agent and Conversation are connected. Save a model connection in Settings, then come back to your Conversation.'
      : 'Your Agent and Conversation are connected. Review your Agent’s settings, then send your first message.')}</p>
    <div className="action-row">
      <button type="button" className="secondary-button" onClick={() => needsModel ? useWorldStore.setState({ settingsOpen: true }) : useNodeSurfaceStore.getState().openInspector(agent.id)}>{t(needsModel ? 'Connect a model' : 'Agent settings')}</button>
      {!needsModel && <button type="button" className="primary-button" onClick={() => {
        useNodeSurfaceStore.getState().openWorkspace(setup.conversationId); useTutorialStore.setState({ quickStart: undefined });
      }}>{t('Open Conversation')}</button>}
      <button type="button" className="onboarding-text-button" onClick={() => useTutorialStore.setState({ quickStart: undefined })}>{t(needsModel ? 'Set up later' : 'Got it')}</button>
    </div>
  </section>;
}
