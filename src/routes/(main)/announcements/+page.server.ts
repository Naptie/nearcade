import type { PageServerLoad } from './$types';
import { ANNOUNCEMENT_PAGE_SIZE } from '$lib/announcements/read';
import {
  countUnreadAnnouncements,
  getViewerAnnouncementReadState,
  listAnnouncements
} from '$lib/announcements/server';
import { canManageAnnouncements } from '$lib/announcements/server';

export const load = (async (event) => {
  const state = await getViewerAnnouncementReadState(event);
  const now = new Date();
  const [result, unreadCount] = await Promise.all([
    listAnnouncements({ page: 1, state, now }),
    countUnreadAnnouncements(state, now)
  ]);
  return {
    ...result,
    unreadCount,
    pageSize: ANNOUNCEMENT_PAGE_SIZE,
    canManage: canManageAnnouncements(event.locals.user)
  };
}) satisfies PageServerLoad;
