import { useCardStateSession } from "../state/cardState";
import { t, useLocale } from "../i18n";
import { Component, Suspense, useMemo, type ReactNode } from "react";
import { worldApi, nodeDocumentDownloadUrl } from "../api/client";
import { useWorldStore } from "../state/worldStore";
import { useOpenFiles } from "../state/openFiles";
import type { WorldCard } from "../types/world";
import { pluginView } from "./registry";
import type { PluginSlot, PluginViewProps } from "./sdk";
import { useWorkspaceAccess } from "../workspace/WorkspaceAccess";

class PluginBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
  render() {
    return this.state.error ? <div role="alert" className="mini-empty">{t("Plugin view unavailable:")} {this.state.error}</div> : this.props.children;
  }
}

export function PluginSurface({ card, slot, level, children }: {
  card: WorldCard; slot: PluginSlot; level: PluginViewProps["level"]; children?: ReactNode;
}) {
  useLocale();
  const access = useWorkspaceAccess();
  const sessionId = useCardStateSession(card.id);
  const definition = useWorldStore((s) => s.catalog.node_types.find((d) => d.id === card.type));
  const updateCard = useWorldStore((s) => s.updateCard);
  const host = useMemo<PluginViewProps["host"]>(() => ({
    state: access.deployed || definition?.state?.mode === 'none' ? undefined : {
      get: () => worldApi.cardState(card.id, 'GET', undefined, undefined, sessionId ?? null),
      set: (value, revision) => worldApi.cardState(card.id, 'PUT', value, revision, sessionId ?? null),
      update: (value, revision) => worldApi.cardState(card.id, 'PATCH', value, revision, sessionId ?? null),
      delete: (revision) => worldApi.cardState(card.id, 'DELETE', undefined, revision, sessionId ?? null),
    },
    setDataPersistence: !access.deployed && definition?.state?.mode === 'scoped' && definition.state.userConfigurable && definition.state.supportedScopes.length > 1
      ? async value => { await updateCard(card.id, { state_scope: value }); } : undefined,
    deployment: access.plugin_access?.[card.id],
    updateConfig: async (config) => { await updateCard(card.id, { config }); },
    getAgentInfo: () => worldApi.getAgentInfo(card.id),
    documentAction: (action, arguments_, expectedRevision) => worldApi.nodeDocumentAction(card.id, action, arguments_, expectedRevision, sessionId ?? null),
    delegationAction: (action, arguments_) => worldApi.nodeDelegationAction(card.id, action, arguments_, sessionId ?? null),
    resourceAction: (action, arguments_, confirm) => worldApi.nodeResourceAction(card.id, action, arguments_, confirm, sessionId ?? null),
    listCards: async (traits = []) => (access.deployed ? useWorldStore.getState().cards.filter(node => node.id in access.permissions) : (await worldApi.getWorld()).nodes).filter(node => {
      const type = useWorldStore.getState().catalog.node_types.find(item => item.id === node.type);
      return traits.every(trait => type?.traits.includes(trait));
    }),
    readDocument: (nodeId = card.id) => worldApi.getNodeDocument(nodeId, sessionId ?? null),
    transform: (operation, request) => worldApi.transformDocument(card.id, operation, request, sessionId ?? null),
    documentDownloadUrl: (name) => nodeDocumentDownloadUrl(card.id, name, sessionId ?? null),
    readFile: (reference, signal) => worldApi.readFilePreview(card.id, reference, signal),
    openFile: (reference, name) => useOpenFiles.getState().open({ ...reference, source_id: card.id }, name),
    clearOpenedFile: () => useOpenFiles.getState().clear(card.id),
  }), [card.id, updateCard, access, definition, sessionId]);
  const reference = definition?.frontend?.[slot];
  if (!reference || !definition) return <>{children}</>;
  const View = pluginView(definition.plugin_id, reference);
  return <PluginBoundary key={`${card.id}:${definition.plugin_id}:${reference}:${card.state_scope}:${sessionId ?? ""}`}>
    <Suspense fallback={<p role="status">{t("Loading plugin view...")}</p>}>
      <View card={card} definition={definition} level={level} host={host} />
    </Suspense>
  </PluginBoundary>;
}
