/**
 * Standard competition ranking over a best-first sorted list: entries whose
 * metric equals the previous entry's share its rank ("1224"), null metrics
 * included. The input order must be the display order of the board being
 * ranked — globally on the server, or of the filtered sub-board on the
 * client. Strictly better entries always precede tied ones in that order,
 * so ranks computed from an accumulated (paginated) prefix are final.
 */
export const competitionRanks = (metrics: Array<number | null>): number[] => {
  const ranks: number[] = [];
  let previousMetric: number | null | undefined;
  let previousRank = 0;
  metrics.forEach((metric, index) => {
    const rank =
      previousMetric !== undefined && metric === previousMetric ? previousRank : index + 1;
    ranks.push(rank);
    previousMetric = metric;
    previousRank = rank;
  });
  return ranks;
};
