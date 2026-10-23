import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, fileUploadSchema, successResponseSchema } from '$lib/schemas/common';
import { imageAssetIdSchema, imageOwnerFieldsShape } from '$lib/schemas/images';

export const imagesContract = {
  /**
   * `POST /api/images` — upload an image asset.
   *
   * The response is an NDJSON event stream (one event object per line), so
   * no output schema is declared — the body is a byte stream, not JSON.
   */
  upload: definePublic({
    method: 'POST',
    path: '/images',
    operationId: 'postImages',
    tags: ['images'],
    scope: 'write:images',
    guard: 'session',
    summary: bilingual('上传图片资源。', 'Upload an image asset.', true),
    description: bilingual(
      '上传一张图片，并可选地将其关联到店铺、评论、帖子、删除申请或草稿上下文；响应为 NDJSON 事件流。事件类型为 `uploading`（进度）、`done`（完成）或 `error`（失败）。',
      'Upload an image and optionally associate it with a shop, comment, post, delete request, or draft context. The response is an NDJSON event stream. Events are `uploading` (progress), `done` (finished) or `error` (failed).'
    )
  }).input(
    z.object({
      file: fileUploadSchema,
      // The same field definitions the upload handler re-parses with, so the
      // published contract cannot accept a `draftKind` the handler rejects.
      ...imageOwnerFieldsShape
    })
  ),

  /** `DELETE /api/images/{imageId}` — delete an image asset. */
  remove: definePublic({
    method: 'DELETE',
    path: '/images/{imageId}',
    operationId: 'deleteImagesByImageId',
    tags: ['images'],
    scope: 'write:images',
    guard: 'session',
    summary: bilingual('删除图片资源。', 'Delete an image asset.', true),
    description: bilingual(
      '删除指定图片资源，并同步清理其与所属实体的关联。',
      'Delete an image asset and clean up its association with the owning entity.'
    )
  })
    .input(z.object({ imageId: imageAssetIdSchema }))
    .output(successResponseSchema)
};
