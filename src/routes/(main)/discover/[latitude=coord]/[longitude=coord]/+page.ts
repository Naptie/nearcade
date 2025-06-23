import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data }) => {
  const { shops, coordinates, radius } = data;

  return {
    shops,
    coordinates,
    radius
  };
};
