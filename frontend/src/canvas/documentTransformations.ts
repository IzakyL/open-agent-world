import type { PluginCatalog, WorldCard } from "../types/world";
import { canAppointMinister, MINISTER_ROLE_CARD } from '../state/ministerRole';

export function transformationOptions(catalog: PluginCatalog, source: WorldCard, target: WorldCard): [string, { label: string; source_traits: string[] }][] {
  if (source.id === target.id) return [];
  if (source.type === MINISTER_ROLE_CARD && canAppointMinister(target, catalog))
    return [['appoint-minister', { label: 'Appoint as Minister', source_traits: ['core.minister-role'] }]];
  const traits = catalog.node_types.find(item => item.id === source.type)?.traits ?? [];
  const operations = catalog.node_types.find(item => item.id === target.type)?.transformations ?? {};
  return Object.entries(operations).filter(([, operation]) => operation.source_traits.every(trait => traits.includes(trait)));
}
