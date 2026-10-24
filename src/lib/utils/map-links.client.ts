/**
 * Neutral "open in maps app" links, resolved through `/api/geo/links`
 * (backed by unified-geo's `/maps/links`). No provider names, URLs or keys
 * live here — the response carries per-platform URLs the caller picks from
 * by user agent, with the in-app globe as the fallback when none fits.
 */

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
    const query = new URLSearchParams({
      longitude: String(params.longitude),
      latitude: String(params.latitude)
    });
    if (params.name) query.set('name', params.name);
    if (params.mode) query.set('mode', params.mode);
    if (params.travelMode) query.set('travelMode', params.travelMode);
    const response = await fetch(`/api/geo/links?${query.toString()}`, {
      signal: params.signal
    });
    if (!response.ok) return null;
    const links = (await response.json()) as MapLinksResponse;
    if (!links?.universal) return null;
    return platformLink(links);
  } catch {
    return null;
  }
}
