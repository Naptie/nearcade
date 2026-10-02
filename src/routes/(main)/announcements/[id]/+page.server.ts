import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { hydrateEntitiesWithImages } from '$lib/images/index.server';
import {
  canManageAnnouncements,
  findAnnouncement,
  getViewerAnnouncementReadState
} from '$lib/announcements/server';
import { isAnnouncementUnread, isAnnouncementVisible } from '$lib/announcements/read';

export const load = (async (event) => {
  const announcement = await findAnnouncement(event.params.id);
  const canManage = canManageAnnouncements(event.locals.user);
  if (!announcement || (!canManage && !isAnnouncementVisible(announcement))) {
    error(404, m.announcement_not_found());
  }

  const [hydrated] = await hydrateEntitiesWithImages(mongo.db(), [announcement]);
  const state = await getViewerAnnouncementReadState(event);

  return {
    announcement: toPlainObject(hydrated),
    unread: isAnnouncementUnread(announcement, state),
    canManage,
    user: event.locals.user
  };
}) satisfies PageServerLoad;
