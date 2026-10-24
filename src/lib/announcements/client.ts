import { invalidateAll } from '$app/navigation';
import { orpc } from '$lib/api/client';
import { isApiError } from '$lib/utils/api-error';
import type { AnnouncementReadState } from './read';

export interface AnnouncementReadResult {
  success: boolean;
  state: AnnouncementReadState;
  unreadCount: number;
}

/**
 * Move the read cursor forward.
 *
 * The typed client throws an `ORPCError` instead of answering with a failed
 * response, so the legacy "not ok" branch becomes the catch below.
 *
 * An API error is re-thrown as it is: it carries the message the server
 * explained the failure with, and the caller shows that message. Wrapping it
 * would replace a useful explanation with a generic one.
 */
export const markAnnouncementsRead = async (body: {
  announcementId?: string;
  all?: boolean;
}): Promise<AnnouncementReadResult> => {
  try {
    const result = await orpc.announcements.markRead(body);
    await invalidateAll();
    return result;
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new Error('Failed to update announcement read state', { cause: error });
  }
};
