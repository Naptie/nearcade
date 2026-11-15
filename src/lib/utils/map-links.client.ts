/**
 * Neutral "open in maps app" links, resolved through the geo links procedure
 * (backed by unified-geo's `/maps/links`). No provider names, URLs or keys
 * live here — the response carries per-platform URLs the caller picks from
 * by user agent, with the in-app globe as the fallback when none fits.
 */

import { orpc } from '$lib/api/client';

export interface MapLinks {
  /** Cross-platform fallback (geo: URI). */
  universal: string;
  android?: string;
  ios?: string;
  /** Web fallback chosen by the point's zone. */
  web?: string;
}

/** Shape of the unified-geo links payload (subset nearcade renders). */
interface MapLinksResponse {
  universal: string;
  android?: string;
  ios?: string;
  web?: string;
}

function platformLink(links: MapLinksResponse): string {
  if (typeof navigator === 'undefined') return links.web ?? links.universal;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return links.ios ?? links.web ?? links.universal;
  if (/Android/i.test(ua)) return links.android ?? links.web ?? links.universal;
  // Desktop: native schemes are unreliable — use the web fallback, which is
  // still one click away from a route on any platform.
  return links.web ?? links.universal;
}

/**
 * Resolve the best "open in maps app" link for a point. Never throws; on
 * failure the caller should fall back to its own in-app map (returning null
 * signals exactly that).
 */
export async function fetchMapLink(params: {
  longitude: number;
  latitude: number;
  name?: string;
  mode?: 'view' | 'navigation';
  travelMode?: 'driving' | 'walking' | 'cycling' | 'transit';
  signal?: AbortSignal;
}): Promise<string | null> {
  try {
    const links = await orpc.geo.links(
      {
        longitude: params.longitude,
        latitude: params.latitude,
        name: params.name,
        mode: params.mode,
        travelMode: params.travelMode
      },
      { signal: params.signal }
    );
    if (!links.universal) return null;
    return platformLink(links);
  } catch {
    return null;
  }
}
