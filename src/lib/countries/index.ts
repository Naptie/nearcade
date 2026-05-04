export interface SupportedCountryLevel {
  dataset: string;
  levelName: string;
  hasChildren: boolean;
}

export interface SupportedCountry {
  numericCode: string;
  name: string;
  addressName: string;
  levels: SupportedCountryLevel[];
}

export const SUPPORTED_COUNTRIES: SupportedCountry[] = [
  {
    numericCode: '156',
    name: 'China',
    addressName: '中国',
    levels: [
      { dataset: 'china-provinces', levelName: 'province', hasChildren: true },
      { dataset: 'china-cities', levelName: 'city', hasChildren: true },
      { dataset: 'china-counties', levelName: 'county', hasChildren: false }
    ]
  }
];

export const getSupportedCountry = (numericCode: string): SupportedCountry | undefined =>
  SUPPORTED_COUNTRIES.find((c) => c.numericCode === numericCode);

export const getSupportedCountryByName = (name: string): SupportedCountry | undefined =>
  SUPPORTED_COUNTRIES.find((c) => c.name === name);

export const getSupportedCountryByDataset = (dataset: string): SupportedCountry | undefined =>
  SUPPORTED_COUNTRIES.find((c) => c.levels.some((l) => l.dataset === dataset));
