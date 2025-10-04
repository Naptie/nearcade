import { error, json, type RequestHandler } from '@sveltejs/kit';
import type { Notification } from '$lib/types';
import { SSC_SECRET } from '$env/static/private';
import { sendFCMNotification } from '$lib/notifications/fcm.server';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== SSC_SECRET) {
    error(401, m.unauthorized());
  }

  const body: Notification = await request.json();
  const { success, response } = await sendFCMNotification(body);

  return json(response, {
    status: success ? (response?.successCount && response.successCount > 0 ? 200 : 400) : 500
  });
};
