import type { LegKind, RouteLeg } from '$lib/types/routing';

interface LegStyle {
  /** Map line color; a leg's own (line brand) color wins over it. */
  color: string;
  /** Font Awesome icon name. */
  icon: string;
  /** Tailwind badge background (spelled out so the class survives purging). */
  badge: string;
  /** Drawn dashed on the map, without casing. */
  dashed: boolean;
}

/** Single source of truth for how each kind of leg looks — in the panel and on the map. */
export const LEG_STYLES: Record<LegKind, LegStyle> = {
  // Walks draw as a dashed line whose dashes march at foot pace. The colour is
  // a full-chroma peer of the other modes: the earlier slate grey sat so close
  // to the map's own greys that the footpath read as a smudge, and a rose line
  // read as an error highlight rather than a footpath — green does neither.
  walk: { color: '#22c55e', icon: 'fa-person-walking', badge: 'bg-green-500', dashed: true },
  ride: { color: '#f59e0b', icon: 'fa-bicycle', badge: 'bg-amber-500', dashed: false },
  drive: { color: '#6366f1', icon: 'fa-car', badge: 'bg-indigo-500', dashed: false },
  bus: { color: '#0ea5e9', icon: 'fa-bus', badge: 'bg-sky-500', dashed: false },
  subway: { color: '#8b5cf6', icon: 'fa-train-subway', badge: 'bg-violet-500', dashed: false },
  rail: { color: '#14b8a6', icon: 'fa-train', badge: 'bg-teal-500', dashed: false },
  ferry: { color: '#06b6d4', icon: 'fa-ferry', badge: 'bg-cyan-500', dashed: false }
};

export const legColor = (leg: Pick<RouteLeg, 'kind' | 'color'>): string =>
  leg.color ?? LEG_STYLES[leg.kind].color;
