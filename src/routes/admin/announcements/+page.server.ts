import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';
import {
  canManageAnnouncements,
  getViewerAnnouncementReadState,
  listAnnouncements
} from '$lib/announcements/server';

export const load = (async (event) => {
  if (!event.locals.user) error(401, m.unauthorized());
  if (!canManageAnnouncements(event.locals.user)) error(403, m.permission_denied());

  const search = event.url.searchParams.get('search') || '';
  const page = Math.max(1, Number(event.url.searchParams.get('page') || '1') || 1);
  const state = await getViewerAnnouncementReadState(event);
  const result = await listAnnouncements({
    page,
    includeUnpublished: true,
    search,
    state
  });
  return {
    ...result,
    search
  };
}) satisfies PageServerLoad;
