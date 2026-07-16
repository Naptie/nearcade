import type { Handle } from '@sveltejs/kit';
import { base } from '$app/paths';
import mongo from '$lib/db/index.server';
import { PostReadability } from '$lib/types';

const SITEMAP_PATH = `${base}/sitemap.xml`;
const ROBOTS_PATH = `${base}/robots.txt`;

const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const sitemapCache: Map<string, { xml: string; expiresAt: number }> = new Map();

function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

function entityUrl(origin: string, path: string): string {
  return `${origin}${base}${path}`;
}

function renderUrlEntry(
  origin: string,
  path: string,
  updatedAt: Date | string | undefined,
  locales: readonly string[]
): string {
  const loc = entityUrl(origin, path);
  const lastmod = toIsoDate(updatedAt);
  const lastmodLine = lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '';
  const hreflangLinks =
    locales
      .map(
        (locale) =>
          `      <xhtml:link rel="alternate" hreflang="${locale}" href="${loc}?locale=${locale}" />`
      )
      .join('\n') + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}" />`;

  return `  <url>
    <loc>${loc}</loc>
${lastmodLine}${hreflangLinks}
  </url>`;
}

async function generateSitemap(origin: string, locales: readonly string[]): Promise<string> {
  const db = mongo.db();

  const [shops, universities, clubs, posts] = await Promise.all([
    db.collection('shops').find({}).project({ id: 1, updatedAt: 1 }).toArray() as Promise<
      Array<{ id: number; updatedAt?: Date }>
    >,
    db
      .collection('universities')
      .find({})
      .project({ id: 1, slug: 1, updatedAt: 1 })
      .toArray() as Promise<Array<{ id: string; slug?: string; updatedAt?: Date }>>,
    db.collection('clubs').find({}).project({ id: 1, slug: 1, updatedAt: 1 }).toArray() as Promise<
      Array<{ id: string; slug?: string; updatedAt?: Date }>
    >,
    db
      .collection('posts')
      .find({ readability: PostReadability.PUBLIC })
      .project({ id: 1, universityId: 1, clubId: 1, updatedAt: 1 })
      .toArray() as Promise<
      Array<{ id: string; universityId?: string; clubId?: string; updatedAt?: Date }>
    >
  ]);

  const staticPaths = [
    '/',
    '/shops',
    '/universities',
    '/clubs',
    '/rankings/campus',
    '/rankings/region'
  ];
  const entries: string[] = staticPaths.map((path) =>
    renderUrlEntry(origin, path, undefined, locales)
  );

  for (const shop of shops) {
    entries.push(renderUrlEntry(origin, `/shops/${shop.id}`, shop.updatedAt, locales));
  }

  for (const university of universities) {
    const id = university.slug || university.id;
    entries.push(renderUrlEntry(origin, `/universities/${id}`, university.updatedAt, locales));
  }

  for (const club of clubs) {
    const id = club.slug || club.id;
    entries.push(renderUrlEntry(origin, `/clubs/${id}`, club.updatedAt, locales));
  }

  for (const post of posts) {
    if (post.universityId) {
      entries.push(
        renderUrlEntry(
          origin,
          `/universities/${post.universityId}/posts/${post.id}`,
          post.updatedAt,
          locales
        )
      );
    }
    if (post.clubId) {
      entries.push(
        renderUrlEntry(origin, `/clubs/${post.clubId}/posts/${post.id}`, post.updatedAt, locales)
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;
}

async function getSitemapResponse(origin: string, locales: readonly string[]): Promise<Response> {
  const now = Date.now();
  const cached = sitemapCache.get(origin);
  if (!cached || cached.expiresAt < now) {
    const xml = await generateSitemap(origin, locales);
    sitemapCache.set(origin, { xml, expiresAt: now + SITEMAP_CACHE_TTL_MS });
  }

  return new Response(sitemapCache.get(origin)!.xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

function getRobotsResponse(origin: string): Response {
  const sitemapUrl = entityUrl(origin, '/sitemap.xml');
  const body = `# Allow all crawlers
User-agent: *
Allow: /

# Disallow the discover page
Disallow: /discover

# Disallow admin pages
Disallow: /admin/

# Disallow API endpoints
Disallow: /api/

# Baidu-specific crawl rate
User-agent: Baiduspider
Crawl-delay: 5

Sitemap: ${sitemapUrl}`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

export function createSeoHandler(locales: readonly string[]): Handle {
  return async ({ event, resolve }) => {
    const { pathname } = event.url;

    if (pathname === SITEMAP_PATH) {
      return getSitemapResponse(event.url.origin, locales);
    }

    if (pathname === ROBOTS_PATH) {
      return getRobotsResponse(event.url.origin);
    }

    return resolve(event);
  };
}

export const handleSeo: Handle = createSeoHandler(['en', 'zh', 'ja']);
