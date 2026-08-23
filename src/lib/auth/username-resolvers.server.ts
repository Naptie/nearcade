import { env } from '$env/dynamic/private';

/**
 * Canonical-username resolution for OAuth account bindings.
 *
 * Shaped as a small strategy pattern: `UsernameResolver` is the interface,
 * `makeUserinfoResolver` is the generic implementation (plain Bearer userinfo
 * fetch + field pick), and providers with special needs register bespoke
 * implementations. Consumers only ever call `getUsernameResolver(providerId)`
 * and use the returned callable — never a specific implementation's name.
 */

export type UsernameResolver = (accessToken: string) => Promise<string | null>;

/** Generic strategy: `GET userinfoUrl` with the access token, read one field. */
function makeUserinfoResolver(userinfoUrl: string, usernameField: string): UsernameResolver {
  return async (accessToken) => {
    try {
      const res = await fetch(userinfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'nearcade' }
      });
      if (!res.ok) return null;
      const profile = (await res.json()) as Record<string, unknown>;
      const username = profile[usernameField];
      return typeof username === 'string' && username ? username : null;
    } catch {
      return null;
    }
  };
}

// --- Provider-specific overrides -------------------------------------------

async function resolveGithub(accessToken: string): Promise<string | null> {
  const apiBaseUrl = env.GITHUB_API_PROXY?.replace(/\/$/, '') ?? 'https://api.github.com';
  const res = await fetch(`${apiBaseUrl}/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'nearcade' }
  });
  if (!res.ok) return null;
  const profile = (await res.json()) as { login?: string };
  return profile.login ?? null;
}

async function resolveDiscord(accessToken: string): Promise<string | null> {
  const baseUrl = env.DISCORD_PROXY?.replace(/\/$/, '') ?? 'https://discord.com';
  const res = await fetch(`${baseUrl}/api/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;
  const profile = (await res.json()) as { username?: string };
  return profile.username ?? null;
}

/**
 * The factory table: one entry per provider whose account binding keeps a
 * verified social link in sync. Providers following the plain-userinfo
 * pattern reuse `makeUserinfoResolver`; anything else registers its own
 * strategy above.
 */
const USERNAME_RESOLVERS: Readonly<Record<string, UsernameResolver>> = {
  github: resolveGithub,
  discord: resolveDiscord,
  'diving-fish': makeUserinfoResolver(
    'https://auth.diving-fish.com/oauth/userinfo',
    'preferred_username'
  ),
  osu: makeUserinfoResolver('https://osu.ppy.sh/api/v2/me', 'username'),
  phira: makeUserinfoResolver('https://api.phira.cn/me', 'name')
};

/** Returns the resolution strategy for a provider, or undefined if it has none. */
export function getUsernameResolver(providerId: string): UsernameResolver | undefined {
  return USERNAME_RESOLVERS[providerId];
}

/** Provider ids that have a resolution strategy (i.e. are account-bindable). */
export function getUsernameResolverProviderIds(): string[] {
  return Object.keys(USERNAME_RESOLVERS);
}
