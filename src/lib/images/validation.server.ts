import { z } from 'zod';

import mongo from '$lib/db/index.server';

import { getImagesByIds } from './index.server';

type WithImages = {
  images?: string[];
};

export const withExistingImages = <Schema extends z.ZodType<WithImages>>(schema: Schema): Schema =>
  schema.superRefine(async (value, ctx) => {
    const imageIds = value.images ?? [];
    const uniqueImageIds = [...new Set(imageIds.filter(Boolean))];
    if (uniqueImageIds.length === 0) {
      return;
    }

    const images = await getImagesByIds(mongo.db(), uniqueImageIds);
    const existingImageIds = new Set(images.map((image) => image.id));

    imageIds.forEach((imageId, index) => {
      if (!existingImageIds.has(imageId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['images', index],
          message: 'Image not found'
        });
      }
    });
  }) as Schema;
