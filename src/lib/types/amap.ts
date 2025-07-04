export type TransportSearchResult = TransportSearchResultObject | string | undefined;

type TransportSearchResultObject =
  | {
      plans: TransportPlans;
    }
  | { routes: TransportRoutes };

type TransportPlans = TransitPlan[];
type TransportRoutes = WalkingRoute[] | RidingRoute[] | DrivingRoute[];

export interface TransitPlan {
  cost: number;
  time: number;
  nightLine: boolean;
  segments: Segment[];
  transit_distance: number;
  railway_distance: number;
  walking_distance: number;
  taxi_distance: number;
  distance: number;
  path: Path;
}

export interface Segment {
  time: number;
  instruction: string;
  transit_mode: string;
  distance: number;
  transit: Transit;
}

export interface Transit {
  origin?: number[];
  destination?: number[];
  path: Path;
  steps?: TransitStep[];
  on_station?: OffStation;
  off_station?: OffStation;
  via_num?: number;
  via_stops?: OffStation[];
  lines?: Line[];
  entrance?: Entrance;
  exit?: Entrance;
}

export interface Entrance {
  name: string;
  location: number[];
}

export interface Line {
  name: string;
  id: string;
  type: string;
  stime: never[] | string;
  etime: never[] | string;
}

export interface OffStation {
  name: string;
  id: string;
  location: number[];
}

export interface TransitStep {
  instruction: string;
  road: string;
  distance: number;
  time: number;
  path: Path;
  action: string;
  assist_action: string;
}

export interface WalkingRoute {
  distance: number;
  time: number;
  steps: WalkingStep[];
}

export interface WalkingStep {
  start_location: number[];
  end_location: number[];
  instruction: string;
  road: string;
  orientation: string;
  distance: number;
  time: number;
  path: Path;
  action: string;
  assistant_action: string;
}

export interface RidingRoute {
  distance: number;
  time: number;
  rides: Ride[];
}

export interface Ride {
  start_location: number[];
  end_location: number[];
  instruction: string;
  road: string;
  orientation: string;
  distance: number;
  time: number;
  path: Path;
  action: string;
}

export interface DrivingRoute {
  steps: DrivingStep[];
  restriction: number;
  distance: number;
  time: number;
  policy: string;
  tolls: number;
  tolls_distance: number;
}

export interface DrivingStep {
  start_location: number[];
  end_location: number[];
  instruction: string;
  orientation: string;
  road: string;
  distance: number;
  tolls: number;
  toll_distance: number;
  toll_road: string;
  time: number;
  path: Array<number[]>;
  action: string;
  assistant_action: string;
  cities: City[];
  tmcs: Tmc[];
  tmcsPaths: TmcsPath[];
}

export interface City {
  name: string;
  citycode: string;
  adcode: string;
  districts: District[];
}

export interface District {
  name: string;
  adcode: string;
}

export interface Tmc {
  lcode: never[];
  distance: number;
  status: Status;
  path: Path;
}

export enum Status {
  未知 = '未知',
  畅通 = '畅通',
  缓行 = '缓行',
  拥堵 = '拥堵'
}

export interface TmcsPath {
  path: Path;
  status: Status;
  distance: number;
}

export type Path = {
  lat: number;
  lng: number;
}[];
