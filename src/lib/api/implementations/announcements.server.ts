import { implement } from '@orpc/server';
import { announcementsContract } from '../contracts/announcements';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError, toWire } from '../errors';
import { toPlainWire } from '../wire.server';
import { assertImagesExist } from '../helpers';
import mongo from '$lib/db/index.server';
import { postId } from '$lib/utils';
import type { Announcement } from '$lib/types';
import {
  attachImagesToOwner,
  deleteImagesForOwner,
  replaceOwnerImages
} from '$lib/images/index.server';
import { m } from '$lib/paraglide/messages';
import {
  announcementCollection,
  applyAnnouncementRead,
  canManageAnnouncements,
  countUnreadAnnouncements,
  getViewerAnnouncementReadState,
  listAnnouncements
} from '$lib/announcements/server';
import {
  announcementCreateResponseSchema,
  announcementDeleteResponseSchema,
  announcementListResponseSchema,
  announcementReadResponseSchema,
  announcementUpdateResponseSchema
} from '$lib/schemas/announcements';
import { isAnnouncementVisible } from '$lib/announcements/read';

const impl = implement(announcementsContract).$context<ApiContext>();

export const announcementsImplementation = {
  /** `GET /api/announcements` */
  list: impl.list.handler(async ({ input, context }) => {
    try {
      const { page } = input;
      const state = await getViewerAnnouncementReadState(context.event);
      const now = new Date();
      const result = await listAnnouncements({ page, state, now });
      return toPlainWire(announcementListResponseSchema, {
        ...result,
        unreadCount: await countUnreadAnnouncements(state, now)
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_announcements());
    }
  }),

  /** `POST /api/announcements` */
  create: impl.create.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }
    if (!canManageAnnouncements(session.user)) {
      apiError('FORBIDDEN', m.permission_denied());
    }

    try {
      const { title, content, images, publish, publishAt, expiresAt } = input;

      // The image assets have to exist — the contract only knows their ids.
      await assertImagesExist(images);

      const now = new Date();
      if (publishAt && publishAt <= now) {
        apiError('BAD_REQUEST', m.announcement_publish_at_must_future());
      }
      const publicationTime = publishAt ?? (publish ? now : null);
      if (expiresAt && publicationTime && expiresAt <= publicationTime) {
        apiError('BAD_REQUEST', m.announcement_expiration_after_publish());
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

      return toWire(announcementCreateResponseSchema, {
        success: true,
        announcementId: announcement.id
      });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `PUT /api/announcements/{announcementId}` */
  update: impl.update.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }
    if (!canManageAnnouncements(session.user)) {
      apiError('FORBIDDEN', m.permission_denied());
    }

    try {
      const { announcementId } = input;

      // The image assets have to exist — the contract only knows their ids.
      await assertImagesExist(input.images);

      const announcement = await announcementCollection().findOne({ id: announcementId });
      if (!announcement) {
        apiError('NOT_FOUND', m.announcement_not_found());
      }

      const title = input.title?.trim() ?? announcement.title;
      const content = input.content?.trim() ?? announcement.content;
      const images = input.images ?? announcement.images ?? [];
      const nextStatus = input.notifyReaders ? 'published' : (input.status ?? announcement.status);
      const now = new Date();
      const publishedAt =
        nextStatus === 'draft'
          ? null
          : input.notifyReaders
            ? now
            : input.publishAt !== undefined
              ? input.publishAt && input.publishAt > now
                ? input.publishAt
                : now
              : announcement.status === 'draft'
                ? now
                : (announcement.publishedAt ?? now);
      const expiresAt =
        input.expiresAt !== undefined ? input.expiresAt : (announcement.expiresAt ?? null);

      if (!title || (!content && images.length === 0)) {
        apiError('BAD_REQUEST', m.title_and_content_are_required());
      }
      if (expiresAt && publishedAt && nextStatus === 'published' && expiresAt <= publishedAt) {
        apiError('BAD_REQUEST', m.announcement_expiration_after_publish());
      }

      const update: Record<string, unknown> = {
        title,
        content,
        images,
        status: nextStatus,
        publishedAt,
        expiresAt,
        updatedAt: new Date()
      };
      if (input.isPinned !== undefined) update.isPinned = input.isPinned;

      const db = mongo.db();
      if (input.images !== undefined) {
        try {
          await replaceOwnerImages(
            db,
            announcement.images ?? [],
            input.images,
            { announcementId },
            { userId: session.user.id, userType: session.user.userType }
          );
        } catch (attachmentError) {
          apiError(
            'BAD_REQUEST',
            attachmentError instanceof Error ? attachmentError.message : m.error_occurred()
          );
        }
      }

      await announcementCollection().updateOne({ id: announcementId }, { $set: update });
      return toWire(announcementUpdateResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `DELETE /api/announcements/{announcementId}` */
  remove: impl.remove.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }
    if (!canManageAnnouncements(session.user)) {
      apiError('FORBIDDEN', m.permission_denied());
    }

    try {
      const { announcementId } = input;
      const announcement = await announcementCollection().findOne({ id: announcementId });
      if (!announcement) {
        apiError('NOT_FOUND', m.announcement_not_found());
      }

      const db = mongo.db();
      await deleteImagesForOwner(
        db,
        { announcementId },
        {
          userId: session.user.id,
          userType: session.user.userType,
          skipPermissionCheck: true
        }
      );
      await announcementCollection().deleteOne({ id: announcementId });
      return toWire(announcementDeleteResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `POST /api/announcements/read` */
  markRead: impl.markRead.handler(async ({ input, context }) => {
    try {
      let announcement = null;
      if (input.announcementId) {
        announcement = await announcementCollection().findOne({ id: input.announcementId });
        if (
          !announcement ||
          (!canManageAnnouncements(context.user) && !isAnnouncementVisible(announcement))
        ) {
          apiError('NOT_FOUND', m.announcement_not_found());
        }
      }

      const result = await applyAnnouncementRead(context.event, {
        announcement,
        all: input.all
      });
      return toWire(announcementReadResponseSchema, { success: true, ...result });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
