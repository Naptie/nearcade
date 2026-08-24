import { SSC_SECRET } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { createClient, type Client } from 'unified-mail-client';

const MAIL_BASE_URL = env.UNIFIED_MAIL_URL ?? 'http://localhost:7273';

let _client: ReturnType<typeof createClient> | undefined;

function getClient() {
  if (!_client) {
    _client = createClient(MAIL_BASE_URL, {
      headers: { authorization: `Bearer ${SSC_SECRET}` }
    });
  }
  return _client;
}

// ---- Result types, derived from the typed client ----

type SendData = NonNullable<Awaited<ReturnType<Client['mail']['send']['post']>>['data']>;
export type SendMailResult = SendData | { success: false; error: string };

type SendBody = Parameters<Client['mail']['send']['post']>[0];
/** Locale for error messages returned by the hub. */
export type MailLocale = NonNullable<SendBody['locale']>;

/**
 * Sends a single transactional email through the unified-mail hub, which
 * routes to Aliyun Direct Mail or Resend based on the recipient's domain.
 */
export async function sendMail(
  to: string,
  subject: string,
  content: { html?: string; text?: string },
  options?: Pick<SendBody, 'locale' | 'fromName' | 'replyTo'>
): Promise<SendMailResult> {
  const client = getClient();
  const { data, error } = await client.mail.send.post({
    to,
    subject,
    html: content.html,
    text: content.text,
    ...options
  });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'mail_send_failed'
    };
  }
  return data;
}
