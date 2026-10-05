/**
 * Turning region IDs into human-readable labels.
 *
 * The filter state stores region IDs only (`ShopFilterState.regions`), because
 * IDs are the thing filtering actually matches on. Displaying them requires a
 * localized name, and that resolution must happen exactly once per surface —
 * every consumer (filter chips, the globe's region drill-down and breadcrumb)
 * has to agree, or the same selection renders differently in different places.
 *
 * This module holds the pure half: given an already-localized region chain it
 * produces the label. The server half — resolving an ID to a chain from the
 * database — lives in `$lib/utils/region.server.ts` and is built on top of
 * these helpers, so client and server derive labels by the same rule.
 */
import { formatAddressParts } from '$lib/utils';
import type { AddressRegionEntry, RegionDisplayLabel } from '$lib/regions/types';

/**
 * Label for the node at `index` of a localized chain: its own name plus the
 * formatted ancestor path above it. Entries carrying no name fall back to their
 * ID so a partially-resolved chain still renders something meaningful.
 *
 * Exported because client-side pickers (the filter panel's cascade) hold
 * localized chains too and must label them by the same rule as the server.
 */
export function regionLabelFromChain(
  chain: readonly AddressRegionEntry[],
  index: number,
  locale?: string
): RegionDisplayLabel {
  const entry = chain[index];
  const name = entry?.name || entry?.id || '';
  const path = formatAddressParts(
    chain.slice(0, index).map((ancestor) => ancestor.name || ancestor.id),
    locale
  );
  return { name, path };
}

/**
 * Everything a surface needs to *show* the regions in a filter: a label per
 * region ID (chips, titles) plus the chain each of them sits in (drill-down
 * breadcrumbs). Both maps are keyed by region ID, so a selection resolves to
 * the same name everywhere it is rendered.
 */
export interface RegionLabelIndex {
  labels: Record<string, RegionDisplayLabel>;
  chains: Record<string, AddressRegionEntry[]>;
}

export const EMPTY_REGION_LABEL_INDEX: RegionLabelIndex = { labels: {}, chains: {} };

/** Index a localized chain: a label and a chain for every node on it. */
export function regionLabelIndexFromChain(
  chain: readonly AddressRegionEntry[],
  locale?: string
): RegionLabelIndex {
  const index: RegionLabelIndex = { labels: {}, chains: {} };
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    // Nodes sharing an ID collapse to the shallowest occurrence, the one that
    // carries the full ancestor path.
    if (!entry?.id || index.labels[entry.id]) continue;
    index.labels[entry.id] = regionLabelFromChain(chain, i, locale);
    index.chains[entry.id] = chain.slice(0, i + 1).map((node) => ({ ...node }));
  }
  return index;
}

/** Merge indexes; later ones win, so a freshly resolved chain overwrites a stale label. */
export function mergeRegionLabelIndexes(...indexes: readonly RegionLabelIndex[]): RegionLabelIndex {
  const merged: RegionLabelIndex = { labels: {}, chains: {} };
  for (const index of indexes) {
    Object.assign(merged.labels, index.labels);
    Object.assign(merged.chains, index.chains);
  }
  return merged;
}

/**
 * Pick the best name for a locale from a region's name map.
 * Priority: exact locale match → language match → English → any available value.
 *
 * Lives here, next to the label rules, because the name map travels: it is
 * carried in admin trees, region rankings and (historically) globe drill links,
 * all of which render on the client. Keeping the rule here means a region reads
 * the same whether it was rendered from the database or from a link.
 */
export function regionNameForLocale(
  name: Record<string, string> | undefined,
  locale: string
): string {
  if (!name) return '';
  if (name[locale]) return name[locale];
  const language = locale.split('-')[0];
  if (language && name[language]) return name[language];
  if (name.en) return name.en;
  return Object.values(name).find((value) => value) ?? '';
}
