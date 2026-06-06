import { base } from '$app/paths';
import { deLocalizeUrl } from '$lib/paraglide/runtime';
import { parseLegacyShopParams } from '$lib/utils/shops/id';
import type { Reroute } from '@sveltejs/kit';

const stripBase = (pathname: string) => {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
};

const rewriteLegacyShopPath = (pathname: string) => {
  const pathWithoutBase = stripBase(pathname);

  const shopMatch = pathWithoutBase.match(/^\/shops\/([^/]+)\/([^/]+)\/?$/);
  if (shopMatch) {
    const parsed = parseLegacyShopParams(shopMatch[1], shopMatch[2]);
    if (parsed) {
      return `${base}/shops/${parsed.unifiedId}`;
    }
  }

  const apiMatch = pathWithoutBase.match(/^\/api\/shops\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (apiMatch) {
    const parsed = parseLegacyShopParams(apiMatch[1], apiMatch[2]);
    if (parsed) {
      return `${base}/api/shops/${parsed.unifiedId}${apiMatch[3] ?? ''}`;
    }
  }

  return pathname;
};

export const reroute: Reroute = ({ url }) => rewriteLegacyShopPath(deLocalizeUrl(url).pathname);
