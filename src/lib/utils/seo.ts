import type { Shop, Club, University, PostWithAuthor } from '$lib/types';
import { formatShopAddress } from '$lib/utils';

export function getCanonicalUrl(url: URL): string {
  const clean = new URL(url.href);
  clean.searchParams.delete('locale');
  return clean.href;
}

export function toAbsoluteUrl(url: string, origin: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return new URL(url, origin).href;
}

export function getLocaleUrl(url: URL, locale: string): string {
  const localized = new URL(url.href);
  localized.searchParams.set('locale', locale);
  return localized.href;
}

export function getHreflangUrls(
  url: URL,
  locales: readonly string[]
): { hreflang: string; href: string }[] {
  return locales.map((locale) => ({ hreflang: locale, href: getLocaleUrl(url, locale) }));
}

export function getOgLocale(locale: string): string {
  const map: Record<string, string> = {
    en: 'en_US',
    zh: 'zh_CN',
    ja: 'ja_JP'
  };
  return map[locale] ?? locale;
}

export function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function stripMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/([*_~`]{1,2})([^*_~`]+)\1/g, '$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function buildKeywords(parts: (string | null | undefined)[]): string {
  const unique = [...new Set(parts.filter(Boolean).map((p) => p!.trim().toLowerCase()))];
  return unique.slice(0, 10).join(', ');
}

export function buildWebSiteSchema(baseUrl: string, searchPathTemplate?: string): object {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'nearcade',
    url: baseUrl
  };
  if (searchPathTemplate) {
    schema.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: searchPathTemplate
      },
      'query-input': 'required name=search_term_string'
    };
  }
  return schema;
}

export function buildBreadcrumbSchema(items: { name: string; item?: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.item ? { item: item.item } : {})
    }))
  };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildOpeningHoursSpecification(
  openingHours: Array<[{ hour: number; minute: number }, { hour: number; minute: number }]>
): unknown[] | undefined {
  if (!openingHours || openingHours.length === 0) return undefined;

  const pad = (n: number) => String(n).padStart(2, '0');

  if (openingHours.length === 1) {
    return [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: DAY_NAMES,
        opens: `${pad(openingHours[0][0].hour)}:${pad(openingHours[0][0].minute)}`,
        closes: `${pad(openingHours[0][1].hour)}:${pad(openingHours[0][1].minute)}`
      }
    ];
  }

  return openingHours.slice(0, 7).map((hours, index) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: DAY_NAMES[index],
    opens: `${pad(hours[0].hour)}:${pad(hours[0].minute)}`,
    closes: `${pad(hours[1].hour)}:${pad(hours[1].minute)}`
  }));
}

export function buildShopSchema(shop: Shop, canonicalUrl: string, imageUrl?: string): object {
  const addressGeneral = shop.address?.general ?? [];
  const address: Record<string, string> = {
    '@type': 'PostalAddress',
    streetAddress: shop.address?.detailed ?? ''
  };

  if (addressGeneral.length >= 1) address.addressCountry = addressGeneral[0];
  if (addressGeneral.length >= 2) address.addressRegion = addressGeneral[1];
  if (addressGeneral.length >= 3) address.addressLocality = addressGeneral[2];
  if (addressGeneral.length >= 4) address.addressDistrict = addressGeneral[3];

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: shop.name,
    description: stripMarkdown(shop.comment || formatShopAddress(shop)),
    url: canonicalUrl,
    address,
    ...(shop.location?.coordinates
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            longitude: shop.location.coordinates[0],
            latitude: shop.location.coordinates[1]
          }
        }
      : {}),
    ...(imageUrl ? { image: imageUrl } : {})
  };

  const openingHours = buildOpeningHoursSpecification(
    shop.openingHours as unknown as Array<
      [{ hour: number; minute: number }, { hour: number; minute: number }]
    >
  );
  if (openingHours) {
    schema.openingHoursSpecification = openingHours;
  }

  return schema;
}

export function buildClubSchema(club: Club, canonicalUrl: string, imageUrl?: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: club.name,
    description: stripMarkdown(club.description || `${club.name} student club`),
    url: canonicalUrl,
    ...(imageUrl ? { image: imageUrl, logo: imageUrl } : {})
  };
}

export function buildUniversitySchema(
  university: University,
  canonicalUrl: string,
  imageUrl?: string
): object {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollegeOrUniversity',
    name: university.name,
    description: stripMarkdown(university.description || university.name),
    url: canonicalUrl
  };

  if (university.website) schema.sameAs = university.website;
  if (imageUrl) {
    schema.image = imageUrl;
    schema.logo = imageUrl;
  }

  const firstCampus = university.campuses?.[0];
  if (firstCampus?.address) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: firstCampus.address,
      addressLocality: firstCampus.city,
      addressRegion: firstCampus.province,
      addressCountry: 'CN'
    };
  }

  return schema;
}

export function buildPostSchema(
  post: PostWithAuthor,
  canonicalUrl: string,
  imageUrl?: string
): object {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title || stripMarkdown(post.content).slice(0, 110),
    description: stripMarkdown(post.content).slice(0, 200),
    url: canonicalUrl,
    datePublished: post.createdAt,
    dateModified: post.updatedAt ?? post.createdAt,
    articleBody: stripMarkdown(post.content)
  };

  if (imageUrl) schema.image = imageUrl;
  if (post.author?.name) {
    schema.author = {
      '@type': 'Person',
      name: post.author.name
    };
  }

  return schema;
}
