import { apiUrl } from '$lib/api/urls';
import { APP_NAME } from '$lib/constants';

const POST_IMAGE_MARKER_PREFIX = `${APP_NAME}-post-image:`;

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeMarkdownSpacing = (content: string) => content.replace(/\n{3,}/g, '\n\n').trim();

export const buildPostImageMarker = (imageId: string) => `${POST_IMAGE_MARKER_PREFIX}${imageId}`;

export const buildPostImageMarkdown = (imageId: string, imageUrl: string, altText = 'image') =>
  `![${altText}](${imageUrl} "${buildPostImageMarker(imageId)}")`;

export const stripPostImageMarkdownByIds = (content: string, imageIds: string[]) => {
  if (!content || imageIds.length === 0) {
    return content;
  }

  let nextContent = content;

  for (const imageId of imageIds) {
    const marker = escapeForRegExp(buildPostImageMarker(imageId));
    const imagePattern = new RegExp(
      String.raw`(?:\n\n)?!\[[^\]]*\]\([^\n)]*\s+"${marker}"\)(?:\n\n)?`,
      'g'
    );
    nextContent = nextContent.replace(imagePattern, '\n\n');
  }

  return normalizeMarkdownSpacing(nextContent);
};

export const buildImageUploadUrl = (
  params: Record<string, string | number | null | undefined> = {}
) => apiUrl('postImages', {}, params);

/**
 * The URL a shop's photo upload goes to.
 *
 * The upload endpoints cannot be called through the typed client — a multipart
 * upload needs the browser's progress events — so their URLs are built from
 * the contract. They live here, with the other upload URL, so a component
 * that opens an upload never has to know an operation id.
 */
export const buildShopPhotoUploadUrl = (shopId: number | string) =>
  apiUrl('postShopsByIdPhotos', { id: shopId });
