import type { LayoutServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import {
  countPendingJoinRequests,
  countUnreadNotifications
} from '$lib/notifications/index.server';
import {
  countUnreadAnnouncements,
  getViewerAnnouncementReadState
} from '$lib/announcements/server';

export const load: LayoutServerLoad = async (event) => {
  const announcementRead = await getViewerAnnouncementReadState(event);
  const user = event.locals.session?.user;
  const [unreadAnnouncements, unreadNotifications, pendingJoinRequests] = await Promise.all([
    countUnreadAnnouncements(announcementRead),
    user ? countUnreadNotifications(mongo, user.id) : Promise.resolve(0),
    user ? countPendingJoinRequests(mongo, user) : Promise.resolve(0)
  ]);

  return {
    session: event.locals.session,
    navigationCounts: {
      unreadAnnouncements,
      unreadNotifications,
      pendingJoinRequests: pendingJoinRequests ?? 0
    }
  };
};
