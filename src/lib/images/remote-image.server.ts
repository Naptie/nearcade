import { env } from '$env/dynamic/private';

export interface ResolvedImageFormat {
  contentType: string;
  extension: string;
  source: 'magic-number' | 'content-type' | 'url' | 'svg-sniff';
}

export interface DownloadedRemoteImage extends ResolvedImageFormat {
  buffer: Buffer<ArrayBufferLike>;
  headerContentType?: string;
}

const IMAGE_EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  ico: 'image/x-icon',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  svg: 'image/svg+xml'
};

const IMAGE_CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/apng': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jxl': 'jxl',
  'image/svg+xml': 'svg'
};

const GENERIC_BINARY_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
  'application/download',
  'application/force-download'
]);

const DEFAULT_REMOTE_IMAGE_USER_AGENT = 'nearcade-remote-image/1.0';

export const normalizeContentType = (
  contentType: string | null | undefined
): string | undefined => {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  if (!normalized) return undefined;

  switch (normalized) {
    case 'image/jpg':
    case 'image/pjpeg':
      return 'image/jpeg';
    case 'image/x-png':
      return 'image/png';
    default:
      return normalized;
  }
};

export const getImageFormatFromContentType = (
  contentType: string | null | undefined
): ResolvedImageFormat | null => {
  const normalized = normalizeContentType(contentType);
  if (!normalized || GENERIC_BINARY_CONTENT_TYPES.has(normalized)) {
    return null;
  }

  const extension = IMAGE_CONTENT_TYPE_TO_EXTENSION[normalized];
  if (extension) {
    return { contentType: normalized, extension, source: 'content-type' };
  }

  if (!normalized.startsWith('image/')) {
    return null;
  }

  const subtype = normalized.slice('image/'.length);
  const inferredExtension = subtype === 'svg+xml' ? 'svg' : subtype.split('+')[0];
  if (!/^[a-z0-9-]{2,10}$/i.test(inferredExtension)) {
    return null;
  }

  return {
    contentType: normalized,
    extension: inferredExtension.toLowerCase(),
    source: 'content-type'
  };
};

export const getImageFormatFromUrl = (url: string): ResolvedImageFormat | null => {
  const urlPath = url.split('?')[0]?.split('#')[0] ?? '';
  const extension = urlPath.split('.').pop()?.toLowerCase();
  if (!extension) return null;

  const contentType = IMAGE_EXTENSION_TO_CONTENT_TYPE[extension];
  if (!contentType) return null;

  return {
    contentType,
    extension: IMAGE_CONTENT_TYPE_TO_EXTENSION[contentType] ?? extension,
    source: 'url'
  };
};

const hasSignature = (buffer: Buffer<ArrayBufferLike>, signature: number[], offset = 0): boolean =>
  buffer.length >= offset + signature.length &&
  signature.every((byte, index) => buffer[offset + index] === byte);

const detectSvgFromBuffer = (buffer: Buffer<ArrayBufferLike>): ResolvedImageFormat | null => {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8').trimStart();
  if (/^(<\?xml[\s\S]*?)?<svg(?:\s|>)/i.test(prefix)) {
    return { contentType: 'image/svg+xml', extension: 'svg', source: 'svg-sniff' };
  }

  return null;
};

export const detectImageFormatFromBuffer = (
  buffer: Buffer<ArrayBufferLike>
): ResolvedImageFormat | null => {
  if (hasSignature(buffer, [0xff, 0xd8, 0xff])) {
    return { contentType: 'image/jpeg', extension: 'jpg', source: 'magic-number' };
  }

  if (hasSignature(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: 'image/png', extension: 'png', source: 'magic-number' };
  }

  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { contentType: 'image/gif', extension: 'gif', source: 'magic-number' };
  }

  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp', source: 'magic-number' };
  }

  if (buffer.toString('ascii', 0, 2) === 'BM') {
    return { contentType: 'image/bmp', extension: 'bmp', source: 'magic-number' };
  }

  if (
    hasSignature(buffer, [0x49, 0x49, 0x2a, 0x00]) ||
    hasSignature(buffer, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return { contentType: 'image/tiff', extension: 'tiff', source: 'magic-number' };
  }

  if (hasSignature(buffer, [0x00, 0x00, 0x01, 0x00])) {
    return { contentType: 'image/x-icon', extension: 'ico', source: 'magic-number' };
  }

  if (hasSignature(buffer, [0xff, 0x0a])) {
    return { contentType: 'image/jxl', extension: 'jxl', source: 'magic-number' };
  }

  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const majorBrand = buffer.toString('ascii', 8, 12);

    if (majorBrand === 'avif' || majorBrand === 'avis') {
      return { contentType: 'image/avif', extension: 'avif', source: 'magic-number' };
    }

    if (['heic', 'heix', 'hevc', 'hevx'].includes(majorBrand)) {
      return { contentType: 'image/heic', extension: 'heic', source: 'magic-number' };
    }

    if (['mif1', 'msf1'].includes(majorBrand)) {
      return { contentType: 'image/heif', extension: 'heif', source: 'magic-number' };
    }

    if (majorBrand === 'jxl ') {
      return { contentType: 'image/jxl', extension: 'jxl', source: 'magic-number' };
    }
  }

  return detectSvgFromBuffer(buffer);
};

export const resolveImageFormat = (
  url: string,
  headerContentType: string | null | undefined,
  buffer: Buffer<ArrayBufferLike>
): ResolvedImageFormat | null => {
  return (
    detectImageFormatFromBuffer(buffer) ??
    getImageFormatFromContentType(headerContentType) ??
    getImageFormatFromUrl(url)
  );
};

export const downloadRemoteImage = async (
  url: string,
  options: {
    userAgent?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<DownloadedRemoteImage> => {
  const targetUrl = env.REVERSE_PROXY ? `${env.REVERSE_PROXY}${encodeURIComponent(url)}` : url;
  const response = await (options.fetchImpl ?? fetch)(targetUrl, {
    headers: {
      'User-Agent': options.userAgent ?? DEFAULT_REMOTE_IMAGE_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const headerContentType = response.headers.get('content-type');
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    throw new Error('Empty response body');
  }

  const format = resolveImageFormat(url, headerContentType, buffer);
  if (!format) {
    throw new Error(`Unsupported image payload (content-type: ${headerContentType ?? 'missing'})`);
  }

  return {
    buffer,
    contentType: format.contentType,
    extension: format.extension,
    source: format.source,
    headerContentType: normalizeContentType(headerContentType)
  };
};
