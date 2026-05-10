import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopIdParamSchema,
  shopPhotosResponseSchema,
  shopPhotoUploadEventSchema,
  shopPhotoUploadRequestSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取店铺照片', 'Get shop photos', true),
    description: bilingual(
      '获取店铺照片列表，并包含上传者信息。',
      'Get the list of shop photos together with uploader information.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    responses: {
      '200': jsonResponse(bilingual('店铺照片', 'Shop photos', true), shopPhotosResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['shops'],
    summary: bilingual('上传店铺照片', 'Upload a shop photo', true),
    description: bilingual(
      '上传一张店铺照片，并以 NDJSON 事件流返回上传进度与结果。',
      'Upload a shop photo and receive progress and completion events as an NDJSON stream.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: shopPhotoUploadRequestSchema
        }
      }
    },
    responses: {
      '200': {
        description: bilingual('照片上传事件流', 'Photo upload event stream', true),
        content: {
          'application/x-ndjson': {
            schema: shopPhotoUploadEventSchema
          }
        }
      },
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
