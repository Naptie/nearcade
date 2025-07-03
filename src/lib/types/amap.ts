export type AMapTransportSearchResult =
  | {
      plans: AMapTransportPlan[];
      routes: AMapTransportRoute[];
    }
  | string
  | undefined;

interface AMapTransportPath {
  lat: number;
  lng: number;
}

interface AMapTransportRoute {
  time: number;
  distance: number;
  path: AMapTransportPath[];
}

type AMapTransportPlan = AMapTransportPlanWithSteps | AMapTransportPlanWithRides;

interface AMapTransportPlanWithSteps extends AMapTransportRoute {
  steps: { path: AMapTransportPath[] }[];
}

interface AMapTransportPlanWithRides extends AMapTransportRoute {
  rides: { path: AMapTransportPath[] }[];
}
