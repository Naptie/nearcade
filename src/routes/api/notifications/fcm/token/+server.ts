import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import { storeFCMToken, removeFCMToken } from '$lib/notifications/fcm.server';

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();

  if (!session?.user?.id) {
    error(401, 'Unauthorized');
  }

  try {
    const { token, action } = (await request.json()) as {
      token: string;
      action: 'store' | 'remove';
    };

    if (!token || !action) {
      error(400, 'Missing token or action');
    }

    if (action === 'store') {
      await storeFCMToken(client, session.user.id, token);
      return json({ success: true, message: 'FCM token stored' });
    } else if (action === 'remove') {
      await removeFCMToken(client, session.user.id, token);
      return json({ success: true, message: 'FCM token removed' });
    } else {
      error(400, 'Invalid action');
    }
  } catch (err) {
    console.error('Error managing FCM token:', err);
    error(500, 'Failed to manage FCM token');
  }
};
