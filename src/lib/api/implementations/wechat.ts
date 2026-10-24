import { implement } from '@orpc/server';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { parseString } from 'xml2js';
import { wechatContract } from '../contracts/wechat';
import type { ApiContext } from '../context';
import { apiError } from '../errors';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { getOrigin } from '$lib/utils/index.server.js';

// WeChat verification token - should be set in environment
const WECHAT_TOKEN = env.WECHAT_TOKEN || '';
// Token expiry time in seconds (5 minutes)
const WECHAT_TOKEN_EXPIRY = 300;
/**
 * Supported WeChat Message Types
 */
type WeChatMsgType =
  'text' | 'image' | 'voice' | 'video' | 'shortvideo' | 'location' | 'link' | 'event';

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
 * A raw response body.
 *
 * WeChat expects plain text or XML, never JSON. The body is therefore a byte
 * stream, which keeps the `Content-Type` the legacy handler set.
 */
const textStream = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });

/** A raw text response, described by the detailed output structure. */
const rawResponse = (status: number, text: string, contentType: string) => ({
  status,
  headers: { 'content-type': contentType },
  body: textStream(text)
});

/**
 * The raw request body.
 *
 * The legacy handler read the request text whatever its content type was: a
 * `text/xml` body arrives as a file, a `text/plain` body as a string, and a
 * JSON body as an already parsed value — which is rendered back to text.
 */
const rawRequestBody = async (input: unknown, contentType: string): Promise<string> => {
  if (input instanceof Blob) return input.text();
  if (typeof input === 'string' && !contentType.includes('json')) return input;
  return JSON.stringify(input) ?? '';
};

const impl = implement(wechatContract).$context<ApiContext>();

export const wechatImplementation = {
  /**
   * GET handler for WeChat server verification.
   *
   * WeChat sends a GET request to verify the server URL.
   */
  verify: impl.verify.handler(async ({ input }) => {
    const signature = input.signature || '';
    const timestamp = input.timestamp || '';
    const nonce = input.nonce || '';
    const echostr = input.echostr || '';

    if (!WECHAT_TOKEN) {
      // A raw 500 cannot be expressed through the detailed output structure —
      // oRPC reserves every status outside 200–399 for errors and would replace
      // the plain-text body with its own JSON envelope. Raising the error is
      // both what actually reaches WeChat and what the response means.
      console.error('[WeChat] WECHAT_TOKEN not configured');
      apiError('INTERNAL_SERVER_ERROR', 'Server configuration error');
    }

    // Sort the token, timestamp, and nonce alphabetically
    const arr = [WECHAT_TOKEN, timestamp, nonce].sort();
    const str = arr.join('');

    // Calculate SHA-1 hash
    const hash = crypto.createHash('sha1').update(str).digest('hex');

    // Compare with signature
    if (hash === signature) {
      // Return echostr as plaintext to complete verification
      return rawResponse(200, echostr, 'text/plain');
    }

    console.error('[WeChat] Signature verification failed');
    // The detailed output structure only carries a 2xx/3xx status, so the
    // rejection is raised as a regular API error — the status (403) is the
    // same as the legacy one.
    apiError('FORBIDDEN', 'Verification failed');
  }),

  /**
   * POST handler for WeChat click events.
   *
   * WeChat sends XML data for user interactions.
   */
  callback: impl.callback.handler(async ({ input, context }) => {
    if (!WECHAT_TOKEN) {
      console.error('[WeChat] WECHAT_TOKEN not configured');
      return rawResponse(200, 'success', 'text/plain');
    }

    try {
      // The body arrives as a file (`text/xml`), as plain text or as an
      // already parsed JSON value.
      const contentType = context.event.request.headers.get('content-type') ?? '';
      const xmlBody = await rawRequestBody(input, contentType);

      // Parse XML body
      const xml = await parseXML(xmlBody);

      // Check if this is a menu click event for binding
      const msgType = xml.MsgType;
      const event = xml.Event;
      const eventKey = xml.EventKey;

      if (msgType !== 'event' || event !== 'CLICK' || eventKey !== 'bind') {
        // Not a bind event, return success to prevent retries
        return rawResponse(200, 'success', 'text/plain');
      }

      // Extract user and bot IDs
      const fromUserName = xml.FromUserName; // User's OpenID
      const toUserName = xml.ToUserName; // Bot's ID

      if (!fromUserName || !toUserName) {
        return rawResponse(200, 'success', 'text/plain');
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

      // Construct the bind URL
      const bindUrl = `${getOrigin(context.event.request)}/settings/account?wechatToken=${token}`;

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

      return rawResponse(200, responseXml, 'application/xml');
    } catch (err) {
      console.error('[WeChat] Error processing POST request:', err);
      // Return success to prevent WeChat from retrying
      return rawResponse(200, 'success', 'text/plain');
    }
  })
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
