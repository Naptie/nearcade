import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import {
  announcementReadRequestSchema,
  announcementReadResponseSchema
} from '$lib/schemas/announcements';

export default defineOpenApiRoute({
  post: {
    tags: ['posts'],
    summary: bilingual('更新公告已读状态', 'Update announcement read state', true),
    description: bilingual(
      '为登录用户持久化已读水位，或为访客写入仅包含已读水位的 Cookie。',
      'Persists a read cursor for signed-in users, or stores a read-cursor cookie for guests.'
    ),
    requestBody: jsonRequestBody(announcementReadRequestSchema),
    responses: {
      '200': jsonResponse(
        bilingual('已读状态', 'Read state', true),
        announcementReadResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('公告不存在', 'Announcement not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
