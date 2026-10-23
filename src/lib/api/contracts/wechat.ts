import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual } from '$lib/schemas/common';

/**
 * The WeChat callback body.
 *
 * WeChat posts an XML document with `Content-Type: text/xml`, which the
 * request decoder hands over as a file; a `text/plain` body arrives as a
 * string and a JSON body as an already parsed value. The legacy handler read
 * the raw request text whatever its content type was, so the body is taken as
 * it comes and the XML is parsed in the implementation.
 */
const wechatXmlBodySchema = z.unknown();

/**
 * A raw response body.
 *
 * WeChat expects plain text or XML, never JSON, so the body is a byte stream
 * and the response needs the detailed output structure.
 *
 * `status` is bounded to 200–399 because that is oRPC's own rule for the
 * detailed structure: it treats any other status as an error and replaces the
 * whole response with its generic JSON 500. Stating the bound here turns a
 * silently discarded body into a validation failure that names the problem.
 * A 4xx/5xx has to be raised as an `ORPCError` instead.
 */
const rawResponseSchema = z.object({
  status: z
    .number()
    .int()
    .min(200)
    .max(399)
    .describe(bilingual('响应状态码（200–399）。', 'The response status code (200–399).')),
  headers: z
    .record(z.string(), z.string())
    .describe(bilingual('响应头。', 'The response headers.')),
  body: z.instanceof(ReadableStream).describe(bilingual('原始响应体。', 'The raw response body.'))
});

export const wechatContract = {
  /** `GET /api/wechat` — the WeChat server verification handshake. */
  verify: definePrivate({
    method: 'GET',
    path: '/wechat',
    operationId: 'verifyWechatServer',
    tags: ['wechat'],
    outputStructure: 'detailed',
    summary: bilingual('校验微信服务器。', 'Verify the WeChat server.', true),
    description: bilingual(
      '校验微信服务器的签名；校验通过时以纯文本返回 `echostr`，否则返回 403。响应体是原始文本（不包裹在信封中）。',
      'Verifies the signature of the WeChat server. On success the `echostr` is returned as plain text, otherwise the answer is a 403. The response body is raw text (not wrapped in an envelope).'
    )
  })
    .input(
      z.object({
        signature: z.string().optional().describe(bilingual('微信签名。', 'The WeChat signature.')),
        timestamp: z.string().optional().describe(bilingual('时间戳。', 'The timestamp.')),
        nonce: z.string().optional().describe(bilingual('随机数。', 'The nonce.')),
        echostr: z.string().optional().describe(bilingual('回显字符串。', 'The echo string.'))
      })
    )
    .output(rawResponseSchema),

  /** `POST /api/wechat` — the WeChat menu callback. */
  callback: definePrivate({
    method: 'POST',
    path: '/wechat',
    operationId: 'handleWechatCallback',
    tags: ['wechat'],
    outputStructure: 'detailed',
    summary: bilingual('处理微信回调。', 'Handle a WeChat callback.', true),
    description: bilingual(
      '处理微信推送的菜单事件；绑定事件会以 XML 回复一条带绑定链接的文本消息，其余情况一律回复 `success`。响应体是原始文本或 XML（不包裹在信封中）。',
      'Handles the menu event WeChat pushes. A binding event is answered with an XML message carrying the binding link, every other case is answered with `success`. The response body is raw text or XML (not wrapped in an envelope).'
    )
  })
    .input(wechatXmlBodySchema)
    .output(rawResponseSchema)
};
