import { env } from '$env/dynamic/private';
import { ObjectId } from 'mongodb';
import mongo from '$lib/db/index.server';
import type { SocialPlatform } from '$lib/constants';
import { getUsernameResolver, getUsernameResolverProviderIds } from './username-resolvers.server';

export const QBIND_DEFAULT_PREFIX = 'nearcade';

/**
 * Platforms that support both an OAuth account binding and a verified social
 * profile link. Binding either side keeps the other in sync (see
 * `syncVerifiedSocialLinkFromAccount`), so the two are interchangeable.
 * Membership follows the resolution strategies in `username-resolvers.server`.
 */
export const ACCOUNT_BINDABLE_SOCIAL_PLATFORMS = getUsernameResolverProviderIds();

export function isAccountBindableSocialPlatform(providerId: string): boolean {
  return (ACCOUNT_BINDABLE_SOCIAL_PLATFORMS as readonly string[]).includes(providerId);
}

export interface QbindGroup {
  name: string;
  number: string;
}

export const getQbindKey = (token: string) =>
  `qbind:${env.QBIND_KEY_PREFIX?.trim() || QBIND_DEFAULT_PREFIX}:${token}`;

/**
 * Parses the `QBIND_GROUPS` env var (JSON array of `{ name, number }`) into a
 * list of groups shown in the QQ verify dialog. Returns an empty array on
 * missing or malformed input.
 */
export const parseQbindGroups = (raw: string | undefined): QbindGroup[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((group): group is Record<string, unknown> => !!group && typeof group === 'object')
      .map((group) => ({
        name: typeof group.name === 'string' ? group.name.trim() : '',
        number:
          typeof group.number === 'number'
            ? String(group.number)
            : typeof group.number === 'string'
              ? group.number.trim()
              : ''
      }))
      .filter((group) => group.name || group.number);
  } catch {
    return [];
  }
};

/**
 * Sets (or creates) a social link with the verified canonical username.
 * The `verified` flag is stored on the link itself; editing the username
 * later drops it (handled by the updateProfile action).
 */
export async function upsertVerifiedSocialLink(
  userId: string,
  platform: SocialPlatform,
  username: string
) {
  const db = mongo.db();
  const usersCollection = db.collection('users');
  const user = await usersCollection.findOne(
    { _id: new ObjectId(userId) },
    { projection: { socialLinks: 1 } }
  );

  const socialLinks = Array.isArray(user?.socialLinks)
    ? (user.socialLinks as Array<{
        platform: SocialPlatform;
        username: string;
        verified?: boolean;
      }>)
    : [];

  const index = socialLinks.findIndex((link) => link.platform === platform);
  const verifiedLink: { platform: SocialPlatform; username: string; verified: boolean } = {
    platform,
    username,
    verified: true
  };
  if (index >= 0) {
    socialLinks[index] = verifiedLink;
  } else {
    socialLinks.push(verifiedLink);
  }

  await usersCollection.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { socialLinks, updatedAt: new Date() } }
  );
}

/**
 * Resolves the canonical username for an OAuth-linked account using the
 * access token stored in the `accounts` collection. Returns null on failure.
 */
export async function resolveCanonicalOAuthUsername(
  providerId: string,
  accessToken: string
): Promise<string | null> {
  const resolver = getUsernameResolver(providerId);
  if (!resolver) return null;
  return resolver(accessToken);
}

/**
 * Keeps the verified social link in sync with a bound OAuth account. Used on
 * both sides of the profile/account binding so they can't diverge:
 *
 * - when an account is created (OAuth sign-in or link), the account hook
 *   calls this to create/update the verified social link;
 * - when a profile link is verified through the OAuth flow, the settings
 *   page calls this to make sure the account binding exists as well.
 *
 * Resolves the canonical username from the freshly cached OAuth profile when
 * available, otherwise from the provider API using the access token. Returns
 * true when the verified link was created/updated.
 */
export async function syncVerifiedSocialLinkFromAccount(
  userId: string,
  providerId: string,
  accessToken?: string | null,
  cachedUsername?: string | null
): Promise<boolean> {
  if (!isAccountBindableSocialPlatform(providerId)) return false;
  const username =
    cachedUsername ||
    (accessToken ? await resolveCanonicalOAuthUsername(providerId, accessToken) : null);
  if (!username) return false;
  await upsertVerifiedSocialLink(userId, providerId as SocialPlatform, username);
  return true;
}
