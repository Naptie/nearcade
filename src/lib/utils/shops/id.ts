import { SHOP_ID_OFFSET_BEMANICN, SHOP_ID_OFFSET_ZIV } from '$lib/constants';

const LEGACY_SOURCES = new Set(['bemanicn', 'ziv', '']);

export type LegacyShopSource = 'bemanicn' | 'ziv' | string;

const toUnifiedShopId = (source: LegacyShopSource, id: number): number => {
  if (source === 'bemanicn') {
    return id + SHOP_ID_OFFSET_BEMANICN;
  }
  if (source === 'ziv') {
    return id + SHOP_ID_OFFSET_ZIV;
  }
  return id;
};

export const parseLegacyShopParams = (
  sourceRaw: string,
  idRaw: string
): { source: LegacyShopSource; id: number; unifiedId: number } | null => {
  const source = sourceRaw.toLowerCase().trim();
  if (!LEGACY_SOURCES.has(source)) {
    return null;
  }

  if (!/^\d+$/.test(idRaw)) {
    return null;
  }

  const id = parseInt(idRaw, 10);

  return {
    source,
    id,
    unifiedId: toUnifiedShopId(source, id)
  };
};
