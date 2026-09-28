import { invalidateAll } from '$app/navigation';
import { fromPath } from '$lib/utils/scoped';
import type { AnnouncementReadState } from './read';

export interface AnnouncementReadResult {
  success: boolean;
  state: AnnouncementReadState;
  unreadCount: number;
}

export const markAnnouncementsRead = async (body: { announcementId?: string; all?: boolean }) => {
  const response = await fetch(fromPath('/api/announcements/read'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error('Failed to update announcement read state');
  }
  const result = (await response.json()) as AnnouncementReadResult;
  await invalidateAll();
  return result;
};
