import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data }) => {
  // The server load already fetched this resource through the contract, and it
  // calls the procedures in-process — so the data is the one this deployment
  // serves, whether or not the browser is pointed at a separate API host. The
  // browser does not repeat the request.
  const { shops, location, radius, limit, gameTitleIds, metro } = data;

  return {
    shops,
    location,
    radius,
    limit,
    gameTitleIds: gameTitleIds ?? [],
    metro,
    // Localized names for the regions in the `f` parameter. Carried through this
    // projection because the chips render from it, not from the raw IDs.
    regionLabels: data.regionLabels ?? {}
  };
};
