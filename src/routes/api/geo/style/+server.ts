import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { requestUnifiedGeoStyle } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

const styleQuerySchema = z.object({
  provider: z.enum(['bing-cn', 'amap', 'google']),
  theme: z.enum(['dark', 'light']).optional(),
  // Some callers pass Bing-style multi-market values (zh-CN,en-US); take the
  // first recognized tag instead of rejecting the request.
  locale: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((tag) => tag.trim())
        .find((tag) => tag === 'zh-CN' || tag === 'en-US')
    )
    .optional()
});

/**
 * Proxy unified-geo's built-in MapLibre style documents (GET /maps/styles).
 * The raw style body is returned as-is — not wrapped in an envelope — with the
 * upstream Cache-Control header passed through (public, max-age=86400 for
 * bing-cn/amap; private, no-store for google).
 */
export const GET: RequestHandler = async ({ url }) => {
  const parsed = styleQuerySchema.safeParse({
    provider: url.searchParams.get('provider') ?? undefined,
    theme: url.searchParams.get('theme') ?? undefined,
    locale: url.searchParams.get('locale') ?? undefined
  });
  if (!parsed.success) error(400, 'Invalid map style request.');

  const { body, cacheControl } = await requestUnifiedGeoStyle(parsed.data);
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      ...(cacheControl ? { 'cache-control': cacheControl } : {})
    }
  });
};
