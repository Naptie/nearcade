import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { nanoid } from 'nanoid';
import { parseString } from 'xml2js';
import crypto from 'crypto';

// WeChat verification token - should be set in environment
const WECHAT_TOKEN = env.WECHAT_TOKEN || '';
// Token expiry time in seconds (5 minutes)
const WECHAT_TOKEN_EXPIRY = 300;
/**
 * Supported WeChat Message Types
 */
type WeChatMsgType =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'shortvideo'
  | 'location'
  | 'link'
  | 'event';

/**
 * Common WeChat Event Types
 */
type WeChatEventType = 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'SCAN' | 'LOCATION' | 'CLICK' | 'VIEW';

/**
 * Type definition for the parsed WeChat XML structure.
 * Note: xml2js parses all values as strings by default.
 */
interface WeChatMessage {
  // Common fields
  ToUserName: string;
  FromUserName: string;
  CreateTime: string;
  MsgType: WeChatMsgType;

  // Standard Message fields
  Content?: string; // For text
  MsgId?: string; // For standard messages
  PicUrl?: string; // For image
  MediaId?: string; // For media

  // Event specific fields
  Event?: WeChatEventType;
  EventKey?: string; // For CLICK or SCAN
  Ticket?: string; // For SCAN (QR Code)

  // Location fields
  Latitude?: string;
  Longitude?: string;
  Precision?: string;

  // Allow dynamic access for obscure fields
  [key: string]: unknown;
}

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
    console.error('[WeChat] WECHAT_TOKEN not configured');
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
    console.error('[WeChat] WECHAT_TOKEN not configured');
    return new Response('success', { headers: { 'Content-Type': 'text/plain' } });
  }

  try {
    const xmlBody = await request.text();

    // Parse XML body
    const xml = await parseXML(xmlBody);

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

const parseXML = async (xml: string): Promise<WeChatMessage> => {
  return new Promise((resolve, reject) => {
    parseString(
      xml,
      {
        explicitArray: false, // Prevents creating arrays for single child nodes
        trim: true, // Trims whitespace from values
        ignoreAttrs: true // WeChat XML usually doesn't use attributes, just tags
      },
      (err: Error | null, result: { xml: WeChatMessage }) => {
        if (err) {
          return reject(err);
        }

        // Validate that the root 'xml' tag exists
        if (!result || !result.xml) {
          return reject(new Error('Invalid WeChat XML structure'));
        }

        // Return the inner object directly
        resolve(result.xml);
      }
    );
  });
};
