import { SHOP_ID_OFFSET_BEMANICN, SHOP_ID_OFFSET_ZIV } from '$lib/constants';

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
  if (source === null) {
    return null;
  }

  const id = parseInt(idRaw, 10);
  if (isNaN(id)) {
    return null;
  }

  return {
    source,
    id,
    unifiedId: toUnifiedShopId(source, id)
  };
};
