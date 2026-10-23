import { orpc } from './client';

/**
 * Delete the images that were uploaded for a draft that was then discarded.
 *
 * An upload stores the image asset immediately; the ids only become owned by
 * a comment or a post when that thing is submitted. A composer that is closed
 * or cleared therefore leaves the asset orphaned, so it has to be removed —
 * and the same few lines were written out again in every composer.
 *
 * Best effort: the reader discarded the draft, so a failed cleanup is a
 * housekeeping problem, not something to interrupt them with.
 */
export const discardDraftImages = async (imageIds: readonly string[]): Promise<void> => {
  if (imageIds.length === 0) return;

  await Promise.all(
    imageIds.map(async (imageId) => {
      try {
        await orpc.images.remove({ imageId });
      } catch (error) {
        console.error('Failed to delete draft image:', error);
      }
    })
  );
};
