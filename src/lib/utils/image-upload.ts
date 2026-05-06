import { fromPath } from '$lib/utils/scoped';

export const buildImageUploadUrl = (
  params: Record<string, string | number | null | undefined> = {}
) => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `${fromPath('/api/images')}?${query}` : fromPath('/api/images');
};
