export interface Shop {
  _id: string;
  id: number;
  name: string;
  province_code: string;
  city_code: string;
  location: {
    latitude: number;
    longitude: number;
  };
  games: Game[];
}

export interface Game {
  id: number;
  name: string;
  version: string;
  quantity: number;
  coin: number;
}

export interface Campus {
  name: string | null;
  longitude: number;
  latitude: number;
}

export interface University {
  _id?: string;
  name: string;
  majorCategory: string;
  natureOfRunning: string;
  schoolType: string;
  is985: boolean;
  is211: boolean;
  isDoubleFirstClass: boolean;
  province: string;
  city: string;
  affiliation: string;  campuses: Campus[];
}

export interface AMapContext {
  amap: typeof AMap | undefined;
  ready: boolean;
  error: string | null;
}
