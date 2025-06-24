import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data }) => {
  const { shops, location, radius } = data;

  return {
    shops,
    location,
    radius
  };
};
