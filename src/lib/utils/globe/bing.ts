import type {
  Map as MaplibreMap,
  RequestParameters,
  ResourceType,
  StyleSpecification
} from 'maplibre-gl';

export const BING_FONT_STACK = ['Roboto Regular', 'Roboto Bold'] as string[];

export const BING_ATTRIBUTION = '© Microsoft Corporation - GS(2025)3133号';

const BING_MKT: Record<string, string> = {
  zh: 'zh-CN,en-US',
  en: 'en-US',
  ja: 'en-US'
};

export function getBingStyleUrl(locale: string, theme: 'light' | 'dark' = 'light'): string {
  const mkt = getBingLanguage(locale);
  if (theme === 'dark') {
    return mkt === 'en-US'
      ? '/globe/bing-style-dark-en-US.json'
      : '/globe/bing-style-dark-zh-CN.json';
  }
  return mkt === 'en-US' ? '/globe/bing-style-en-US.json' : '/globe/bing-style-zh-CN.json';
}

export function getBingLanguage(locale: string): string {
  return BING_MKT[locale] ?? BING_MKT.en;
}

export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const scale = 1 << z;
  const x = Math.floor(((lng + 180) / 360) * scale);
  const y = Math.floor(
    ((1 -
      Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      scale
  );
  return { x, y };
}

export function xyzToQuadkey(x: number, y: number, z: number): string {
  let q = '';
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    let d = 0;
    if (x & mask) d += 1;
    if (y & mask) d += 2;
    q += d;
  }
  return q;
}

export function prefetchBingTiles(
  instance: MaplibreMap,
  center: [number, number],
  zoom: number,
  options: { radius?: number; sourceId?: string } = {}
): void {
  const { radius = 1, sourceId = 'bing-mvt' } = options;
  if (!instance.isStyleLoaded()) return;

  const style = instance.getStyle();
  const source = style.sources[sourceId] as { tiles?: string[] } | undefined;
  if (!source?.tiles?.length) return;

  const template = source.tiles[0];
  const z = Math.floor(zoom);
  const { x: cx, y: cy } = lngLatToTile(center[0], center[1], z);
  const maxTiles = 1 << z;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = (((cx + dx) % maxTiles) + maxTiles) % maxTiles;
      const y = Math.max(0, Math.min(maxTiles - 1, cy + dy));
      const url = template
        .replaceAll('{z}', String(z))
        .replaceAll('{x}', String(x))
        .replaceAll('{y}', String(y));
      // Fire-and-forget: warm the browser cache before the flyTo camera arrives.
      void fetch(url, { method: 'GET', priority: 'low' } as RequestInit).catch(() => undefined);
    }
  }
}

export function bingTransformRequest(
  url: string,
  resourceType: ResourceType | undefined
): RequestParameters {
  // Raster sources use {z}/{x}/{y} (converted from {quadkey} at load time).
  // Convert back to Bing quadkey for traffic, background imagery, etc.
  const tileMatch = url.match(/\/comp\/ch\/(\d+)\/(\d+)\/(\d+)\?/);
  if (tileMatch && resourceType === 'Tile') {
    const [, z, x, y] = tileMatch.map(Number);
    url = url.replace(`/${z}/${x}/${y}?`, `/${xyzToQuadkey(x, y, z)}?`);
  }

  // Handle glyph requests
  if (resourceType === 'Glyphs') {
    let glyphUrl: URL | undefined;
    try {
      glyphUrl = new URL(url, 'https://dynamic.t0.tiles.ditu.live.com');
    } catch {
      // Invalid URL — leave it untouched for mapbox to handle.
    }
    const isBing = glyphUrl?.hostname.endsWith('.ditu.live.com') ?? false;
    // For Bing CDN URLs: convert spaces to hyphens for Bing's font naming convention
    if (isBing && glyphUrl?.searchParams.get('glyphs')?.includes(' ')) {
      url = url.replace(/%20/g, '-').replace(/ /g, '-');
    }
    // For local fonts (Sora/Noto): redirect to local path
    else if (
      glyphUrl?.searchParams.has('glyphs') &&
      (url.includes('Sora') || url.includes('Noto'))
    ) {
      const baseUrl = import.meta.env.BASE_URL || '/';
      const fontstack = decodeURIComponent(glyphUrl.searchParams.get('glyphs') ?? '');
      const range = glyphUrl.searchParams.get('range') ?? '0-255';
      url = `${baseUrl}fonts/${fontstack}/${range}.pbf`;
    }
  }

  return { url };
}

const ADDITIONAL_TILE_ENDPOINTS = [1, 2, 3] as const;

function expandBingTileEndpoints(tiles: string[]): string[] {
  const result = [...tiles];
  for (const url of tiles) {
    const match = url.match(/dynamic\.t(\d+)\.tiles\.ditu\.live\.com/);
    if (!match) continue;
    for (const idx of ADDITIONAL_TILE_ENDPOINTS) {
      const expanded = url.replace(/dynamic\.t\d+\.tiles/, `dynamic.t${idx}.tiles`);
      if (!result.includes(expanded)) result.push(expanded);
    }
  }
  return result;
}
export function fixBingStyleUrls(style: StyleSpecification): StyleSpecification {
  const raw = JSON.stringify(style)
    .replaceAll('raster://', 'https://')
    .replaceAll('{quadkey}', '{z}/{x}/{y}');
  const result = JSON.parse(raw) as StyleSpecification;
  // Remove background raster layers (globe uses 3D textures instead) but keep
  // the jk raster-label layer — it provides map labels (roads, place names)
  // that the globe's vector layers don't fully cover.
  result.layers = result.layers.filter((layer) => layer.type !== 'raster' || layer.source === 'jk');
  // Remove geographic bounds on the jk source so labels render globally on the
  // globe (the original bounds are Korea-only).
  if (result.sources.jk && 'bounds' in result.sources.jk) {
    delete result.sources.jk.bounds;
  }
  for (const source of Object.values(result.sources)) {
    if ('attribution' in source && !source.attribution) source.attribution = BING_ATTRIBUTION;
    if ('tiles' in source && Array.isArray(source.tiles)) {
      source.tiles = expandBingTileEndpoints(source.tiles);
    }
  }
  return result;
}
