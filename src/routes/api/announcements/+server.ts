import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';
import mongo from '$lib/db/index.server';
import { postId, toPlainObject } from '$lib/utils';
import type { Announcement } from '$lib/types';
import { attachImagesToOwner } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import {
  announcementCreateRequestSchema,
  announcementCreateResponseSchema,
  announcementListQuerySchema,
  announcementListResponseSchema
} from '$lib/schemas/announcements';
import { parseJsonOrError, parseQueryOrError } from '$lib/utils/validation.server';
import {
  canManageAnnouncements,
  countUnreadAnnouncements,
  getViewerAnnouncementReadState,
  listAnnouncements,
  announcementCollection
} from '$lib/announcements/server';

const announcementCreateRequestWithExistingImagesSchema = withExistingImages(
  announcementCreateRequestSchema
);

export const GET: RequestHandler = async (event) => {
  try {
    const { page } = parseQueryOrError(announcementListQuerySchema, event.url);
    const state = await getViewerAnnouncementReadState(event);
    const now = new Date();
    const result = await listAnnouncements({ page, state, now });
    return json(
      announcementListResponseSchema.parse(
        toPlainObject({
          ...result,
          unreadCount: await countUnreadAnnouncements(state, now)
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) throw err;
    console.error('Error listing announcements:', err);
    error(500, m.failed_to_load_announcements());
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) error(401, m.unauthorized());
    if (!canManageAnnouncements(session.user)) error(403, m.permission_denied());

    const { title, content, images, publish, publishAt, expiresAt } = await parseJsonOrError(
      request,
      announcementCreateRequestWithExistingImagesSchema
    );
    const now = new Date();
    if (publishAt && publishAt <= now) {
      error(400, m.announcement_publish_at_must_future());
    }
    const publicationTime = publishAt ?? (publish ? now : null);
    if (expiresAt && publicationTime && expiresAt <= publicationTime) {
      error(400, m.announcement_expiration_after_publish());
    }

    const announcement: Announcement = {
      id: postId(),
      title,
      content,
      images,
      createdBy: session.user.id,
      createdAt: now,
      isPinned: false,
      status: publicationTime ? 'published' : 'draft',
      publishedAt: publicationTime,
      expiresAt: expiresAt ?? null
    };

    const db = mongo.db();
    await announcementCollection().insertOne(announcement);
    try {
      if (images.length > 0) {
        await attachImagesToOwner(
          db,
          images,
          { announcementId: announcement.id },
          { userId: session.user.id, userType: session.user.userType }
        );
      }
    } catch (attachmentError) {
      await announcementCollection().deleteOne({ id: announcement.id });
      throw attachmentError;
    }

    return json(
      announcementCreateResponseSchema.parse({ success: true, announcementId: announcement.id }),
      { status: 201 }
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) throw err;
    console.error('Error creating announcement:', err);
    error(500, m.internal_server_error());
  }
};
