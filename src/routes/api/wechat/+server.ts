import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

// WeChat verification token - should be set in environment
const WECHAT_TOKEN = env.AUTH_WECHAT_TOKEN || '';
// Token expiry time in seconds (5 minutes)
const WECHAT_TOKEN_EXPIRY = 300;

/**
 * GET handler for WeChat server verification
 * WeChat sends a GET request to verify the server URL
 */
export const GET = async ({ url }) => {
  const signature = url.searchParams.get('signature') || '';
  const timestamp = url.searchParams.get('timestamp') || '';
  const nonce = url.searchParams.get('nonce') || '';
  const echostr = url.searchParams.get('echostr') || '';

  if (!WECHAT_TOKEN) {
    console.error('[WeChat] AUTH_WECHAT_TOKEN not configured');
    return new Response('Server configuration error', { status: 500 });
  }

  // Sort the token, timestamp, and nonce alphabetically
  const arr = [WECHAT_TOKEN, timestamp, nonce].sort();
  const str = arr.join('');

  // Calculate SHA-1 hash
  const hash = crypto.createHash('sha1').update(str).digest('hex');

  // Compare with signature
  if (hash === signature) {
    // Return echostr as plaintext to complete verification
    return new Response(echostr, {
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  console.error('[WeChat] Signature verification failed');
  return new Response('Verification failed', { status: 403 });
};

/**
 * POST handler for WeChat click events
 * WeChat sends XML data for user interactions
 */
export const POST = async ({ request }) => {
  if (!WECHAT_TOKEN) {
    console.error('[WeChat] AUTH_WECHAT_TOKEN not configured');
    return new Response('success', { headers: { 'Content-Type': 'text/plain' } });
  }

  try {
    const xmlBody = await request.text();

    // Parse XML body
    const xml = parseXML(xmlBody);

    // Check if this is a menu click event for binding
    const msgType = xml.MsgType;
    const event = xml.Event;
    const eventKey = xml.EventKey;

    if (msgType !== 'event' || event !== 'CLICK' || eventKey !== 'bind') {
      // Not a bind event, return success to prevent retries
      return new Response('success', { headers: { 'Content-Type': 'text/plain' } });
    }

    // Extract user and bot IDs
    const fromUserName = xml.FromUserName; // User's OpenID
    const toUserName = xml.ToUserName; // Bot's ID

    if (!fromUserName || !toUserName) {
      return new Response('success', { headers: { 'Content-Type': 'text/plain' } });
    }

    // Generate a unique token for this bind session
    const token = nanoid(32);

    // Store the bind session in Redis
    await ensureConnected();
    const bindData = JSON.stringify({
      openId: fromUserName,
      token: token,
      createdAt: new Date().toISOString()
    });
    await redis.setEx(`wechat_bind:${token}`, WECHAT_TOKEN_EXPIRY, bindData);

    // Determine the host for the bind URL
    let host: string | undefined = publicEnv.PUBLIC_HOST;
    if (!host) {
      // Fall back to the Host header
      const hostHeader = request.headers.get('host');
      if (hostHeader) {
        // Determine protocol from X-Forwarded-Proto header (set by reverse proxies)
        // Default to https in production, http only for localhost development
        const forwardedProto = request.headers.get('x-forwarded-proto');
        const isSecure =
          forwardedProto === 'https' || (!forwardedProto && !hostHeader.startsWith('localhost:'));
        host = `${isSecure ? 'https' : 'http'}://${hostHeader}`;
      }
    }

    // Construct the bind URL
    const bindUrl = `${host}/settings/account?wechatToken=${token}`;

    // Get current timestamp in seconds
    const createTime = Math.floor(Date.now() / 1000);

    // Construct XML response
    // Note: Chinese text is intentional as WeChat users are Chinese speakers
    const responseXml = `<xml>
  <ToUserName><![CDATA[${fromUserName}]]></ToUserName>
  <FromUserName><![CDATA[${toUserName}]]></FromUserName>
  <CreateTime>${createTime}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[点击以下链接完成账号绑定（5分钟内有效）：\n${bindUrl}]]></Content>
</xml>`;

    return new Response(responseXml, {
      headers: { 'Content-Type': 'application/xml' }
    });
  } catch (err) {
    console.error('[WeChat] Error processing POST request:', err);
    // Return success to prevent WeChat from retrying
    return new Response('success', { headers: { 'Content-Type': 'text/plain' } });
  }
};

/**
 * Simple XML parser for WeChat messages
 * This parser is sufficient for WeChat's fixed XML format which uses a flat
 * structure with optional CDATA wrapping. WeChat's XML messages follow a
 * consistent pattern that doesn't require a full XML parser.
 */
function parseXML(xml: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Match all XML tags and their content (with optional CDATA wrapping)
  const regex = /<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/g;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const [, tag, value] = match;
    result[tag] = value;
  }

  return result;
}
