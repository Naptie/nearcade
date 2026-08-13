import { SSC_SECRET } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { createClient, type Client } from 'unified-sms-client';
import { getCountryMachineCounts } from '$lib/regions/utils.server';

const SMS_BASE_URL = env.UNIFIED_SMS_URL ?? 'http://localhost:7272';

let _client: ReturnType<typeof createClient> | undefined;

function getClient() {
  if (!_client) {
    _client = createClient(SMS_BASE_URL, {
      headers: { authorization: `Bearer ${SSC_SECRET}` }
    });
  }
  return _client;
}

// ---- Result types, derived from the typed client ----

type RegionsData = NonNullable<Awaited<ReturnType<Client['regions']['get']>>['data']>;
export type SupportedRegion = RegionsData[number];

type SendData = NonNullable<Awaited<ReturnType<Client['sms']['send']['post']>>['data']>;
export type SendOtpResult = SendData | { success: false; error: string };

type VerifyData = NonNullable<Awaited<ReturnType<Client['sms']['verify']['post']>>['data']>;
export type VerifyOtpResult = VerifyData | { success: false; error: string };

type StatusData = NonNullable<
  Awaited<ReturnType<ReturnType<Client['sms']['status']>['get']>>['data']
>;
export type TelegramStatusResult = StatusData | { success: false; error: string };

type SendBody = Parameters<Client['sms']['send']['post']>[0];
/** Locale for error messages and the Telegram bot conversation. */
export type SmsLocale = NonNullable<SendBody['locale']>;

// ---- Region list cache ----
//
// The dial-code list is fetched once (warmed up at app startup) and kept in
// memory, ordered by arcade presence using the `region_rankings` data, so
// requests return the sorted list directly without re-fetching. Region
// rankings are keyed by ISO 3166-1 alpha-2 code, which matches `isoCode`.

let regionsCache: { regions: SupportedRegion[]; fetchedAt: number } | null = null;
let regionsFetching: Promise<SupportedRegion[]> | null = null;
const REGIONS_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Order regions by machine count (from `region_rankings`, keyed by
 * `isoCode`) so countries with the most arcade presence float to the top.
 * Regions without a ranking entry fall through to alphabetical order at
 * the end, mirroring the region-filter selector behaviour.
 */
export function sortRegionsByRankings(
  regions: SupportedRegion[],
  machineCounts: Map<string, number>
): SupportedRegion[] {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  return [...regions].sort((a, b) => {
    const ma = machineCounts.get(a.isoCode) ?? -1;
    const mb = machineCounts.get(b.isoCode) ?? -1;
    if (mb !== ma) return mb - ma;
    return collator.compare(a.dialCode, b.dialCode);
  });
}

async function loadSortedRegions(): Promise<SupportedRegion[] | null> {
  const client = getClient();
  const { data, error } = await client.regions.get();
  if (error || !data || data.length === 0) return null;
  const machineCounts = await getCountryMachineCounts();
  return sortRegionsByRankings(data, machineCounts);
}

/** Returns the cached, ranking-sorted region list (lazy-initialised). */
export async function getSupportedRegions(): Promise<SupportedRegion[]> {
  if (regionsCache && Date.now() - regionsCache.fetchedAt < REGIONS_CACHE_TTL_MS) {
    return regionsCache.regions;
  }
  if (!regionsFetching) {
    regionsFetching = loadSortedRegions()
      .then((regions) => {
        if (regions) {
          regionsCache = { regions, fetchedAt: Date.now() };
          return regions;
        }
        // Fetch failed or came back empty — keep serving a stale cache
        // rather than caching an empty list.
        return regionsCache?.regions ?? [];
      })
      .catch((err) => {
        console.error('Failed to load SMS regions:', err);
        return regionsCache?.regions ?? [];
      })
      .finally(() => {
        regionsFetching = null;
      });
  }
  return regionsFetching;
}

export async function initSmsRegions(): Promise<void> {
  await getSupportedRegions();
}

export async function sendPhoneOtp(
  phoneNumber: string,
  dialCode: string,
  locale: SmsLocale
): Promise<SendOtpResult> {
  const client = getClient();
  const { data, error } = await client.sms.send.post({
    phoneNumber,
    dialCode,
    codeLength: 6,
    locale
  });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'sms_send_failed'
    };
  }
  return data;
}

export async function verifyPhoneOtp(
  phoneNumber: string,
  dialCode: string,
  code: string,
  locale: SmsLocale
): Promise<VerifyOtpResult> {
  const client = getClient();
  const { data, error } = await client.sms.verify.post({ phoneNumber, dialCode, code, locale });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'sms_verify_failed'
    };
  }
  return data;
}

export async function getTelegramVerificationStatus(
  sessionId: string,
  locale: SmsLocale
): Promise<TelegramStatusResult> {
  const client = getClient();
  const { data, error } = await client.sms.status({ sessionId }).get({ query: { locale } });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'telegram_status_failed'
    };
  }
  return data;
}
