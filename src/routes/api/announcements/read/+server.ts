import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';
import {
  announcementReadRequestSchema,
  announcementReadResponseSchema
} from '$lib/schemas/announcements';
import { parseJsonOrError } from '$lib/utils/validation.server';
import {
  announcementCollection,
  applyAnnouncementRead,
  canManageAnnouncements
} from '$lib/announcements/server';
import { isAnnouncementVisible } from '$lib/announcements/read';

export const POST: RequestHandler = async (event) => {
  try {
    const body = await parseJsonOrError(event.request, announcementReadRequestSchema);
    let announcement = null;
    if (body.announcementId) {
      announcement = await announcementCollection().findOne({ id: body.announcementId });
      if (
        !announcement ||
        (!canManageAnnouncements(event.locals.user) && !isAnnouncementVisible(announcement))
      ) {
        error(404, m.announcement_not_found());
      }
    }

    const result = await applyAnnouncementRead(event, {
      announcement,
      all: body.all
    });
    return json(announcementReadResponseSchema.parse({ success: true, ...result }));
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) throw err;
    console.error('Error updating announcement read state:', err);
    error(500, m.internal_server_error());
  }
};
