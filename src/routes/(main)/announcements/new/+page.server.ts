import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';
import { loginRedirect } from '$lib/utils/scoped';
import { canManageAnnouncements } from '$lib/announcements/server';

export const load = (async ({ locals, url }) => {
  if (!locals.session?.user) throw loginRedirect(url);
  if (!canManageAnnouncements(locals.user)) error(403, m.permission_denied());
  return { user: locals.user };
}) satisfies PageServerLoad;
