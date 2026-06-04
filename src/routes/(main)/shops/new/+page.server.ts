import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, parent }) => {
  const { session } = await parent();
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const address = url.searchParams.get('address');

  return {
    initialLat: lat ? parseFloat(lat) : null,
    initialLng: lng ? parseFloat(lng) : null,
    initialAddress: address ?? null,
    user: session?.user
  };
};
