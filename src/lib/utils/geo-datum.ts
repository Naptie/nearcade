/**
 * Datum of the map surface (and of stored shop coordinates) for a region id
 * chain: GCJ02 on the mainland and in the SARs, WGS84 for Taiwan and abroad.
 * Mirrors the zone datum rule the location service assigns per point.
 */
export function regionDatum(
  regionIds: Array<string | { id: string }>
): 'WGS84' | 'GCJ02' {
  const ids = regionIds.map((region) => (typeof region === 'string' ? region : region.id));
  const isChina = ids.some((id) => id === 'CN' || id === 'HK' || id === 'MO');
  const isTaiwan = ids.some((id) => id === 'TW' || id.startsWith('CN-71'));
  return isChina || isTaiwan ? (isTaiwan ? 'WGS84' : 'GCJ02') : 'WGS84';
}
