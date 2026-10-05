import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';
import {
  announcementCollection,
  canManageAnnouncements,
  getViewerAnnouncementReadState,
  listAnnouncements
} from '$lib/announcements/server';
import { ANNOUNCEMENT_PAGE_SIZE } from '$lib/announcements/read';
import { parsePageParam, readParam } from '$lib/admin/list-state';

export const load = (async (event) => {
  if (!event.locals.user) error(401, m.unauthorized());
  if (!canManageAnnouncements(event.locals.user)) error(403, m.permission_denied());

  const search = readParam(event.url, 'search');
  const page = parsePageParam(event.url);
  const state = await getViewerAnnouncementReadState(event);
  const result = await listAnnouncements({
    page,
    includeUnpublished: true,
    search,
    state
  });

  // `listAnnouncements` only reports `page`, so count the same scope here to feed
  // the shared pagination control its numbered window. Keep the filter in sync
  // with the one `listAnnouncements` builds for `includeUnpublished: true`.
  const countFilter: Record<string, unknown> = {};
  if (search.trim()) {
    const searchRegex = { $regex: search.trim(), $options: 'i' };
    countFilter.$and = [{ $or: [{ title: searchRegex }, { content: searchRegex }] }];
  }
  const totalCount = await announcementCollection().countDocuments(countFilter);

  return {
    ...result,
    search,
    currentPage: result.page,
    pageSize: ANNOUNCEMENT_PAGE_SIZE,
    totalCount
  };
}) satisfies PageServerLoad;
