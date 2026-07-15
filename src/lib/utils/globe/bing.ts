import type { RequestParameters, ResourceType, StyleSpecification } from 'maplibre-gl';

export const BING_FONT_STACK = ['Roboto Regular', 'Roboto Bold'] as string[];

export const BING_ATTRIBUTION = '© Microsoft Corporation - GS(2025)3133号';

const BING_MKT: Record<string, string> = {
  zh: 'zh-CN,en-US',
  en: 'en-US',
  ja: 'en-US'
};

export function getBingStyleUrl(locale: string): string {
  const mkt = getBingLanguage(locale);
  return mkt === 'en-US' ? '/globe/bing-style-en-US.json' : '/globe/bing-style-zh-CN.json';
}

export function getBingLanguage(locale: string): string {
  return BING_MKT[locale] ?? BING_MKT.en;
}

export function xyzToQuadkey(x: number, y: number, z: number): string {
  let q = '';
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    let d = 0;
    if (x & mask) d += 1;
    if (y & mask) d += 2;
    q += d;
  }
  return q;
}

export function bingTransformRequest(
  url: string,
  resourceType: ResourceType | undefined
): RequestParameters {
  // Raster sources use {z}/{x}/{y} (converted from {quadkey} at load time).
  // Convert back to Bing quadkey for traffic, background imagery, etc.
  const tileMatch = url.match(/\/comp\/ch\/(\d+)\/(\d+)\/(\d+)\?/);
  if (tileMatch && resourceType === 'Tile') {
    const [, z, x, y] = tileMatch.map(Number);
    url = url.replace(`/${z}/${x}/${y}?`, `/${xyzToQuadkey(x, y, z)}?`);
  }

  // Handle glyph requests
  if (resourceType === 'Glyphs') {
    // For Bing CDN URLs: convert spaces to hyphens for Bing's font naming convention
    if (url.includes('ditu.live.com') && url.includes('glyphs=') && url.includes(' ')) {
      url = url.replace(/%20/g, '-').replace(/ /g, '-');
    }
    // For local fonts (Sora/Noto): redirect to local path
    else if (url.includes('glyphs=') && (url.includes('Sora') || url.includes('Noto'))) {
      const base = import.meta.env.BASE_URL || '/';
      const fontstackMatch = url.match(/glyphs=([^&]+)/);
      if (fontstackMatch) {
        const fontstack = decodeURIComponent(fontstackMatch[1]);
        const rangeMatch = url.match(/range=(\d+-\d+)/);
        const range = rangeMatch ? rangeMatch[1] : '0-255';
        url = `${base}fonts/${fontstack}/${range}.pbf`;
      }
    }
  }

  return { url };
}

export function fixBingStyleUrls(style: StyleSpecification): StyleSpecification {
  const raw = JSON.stringify(style)
    .replaceAll('raster://', 'https://')
    .replaceAll('{quadkey}', '{z}/{x}/{y}');
  const result = JSON.parse(raw) as StyleSpecification;
  result.layers = result.layers.filter((layer) => layer.type !== 'raster');
  for (const source of Object.values(result.sources)) {
    if ('attribution' in source && !source.attribution) source.attribution = BING_ATTRIBUTION;
  }
  return result;
}

// Sorted longest-first so partial hex matches don't collide.
const DARK_COLOR_MAP: Record<string, string> = {
  // Land / background
  '#F9FAF7': '#1A1D23',
  '#F9FCF9': '#1C1F26',
  '#F8F8F8': '#1E2128',
  '#F8F6F0': '#1C1F26',
  '#F7F4F2': '#1E2128',
  '#F5F6F3': '#20232A',
  '#F4F1E9': '#22252C',
  '#F1EFEB': '#24272E',
  '#F1F1F1': '#24272E',
  '#F1F0EA': '#262930',
  '#EDEBE8': '#262930',
  '#EDEBE5': '#2C2F36',
  '#EBE9E3': '#2A2D34',
  '#EAE7E0': '#282B32',
  '#E8E8E8': '#2A2D34',
  '#E4E1E3': '#2E3138',
  '#E2E2DD': '#30333A',
  '#E0E0E0': '#32353C',
  '#D7D7D2': '#34373E',
  '#D6D6D6': '#363940',
  '#CACAC2': '#383B42',
  '#C7C7C7': '#3A3D44',
  '#BFBFBF': '#3C3F46',
  '#F0F0F0': '#2E3138',

  // Water
  '#A6D5FF': '#1B3D6B',
  '#DDEBEF': '#152D4A',
  '#D5EEFB': '#163050',
  '#D5EFFC': '#163050',
  '#D0E9F6': '#173356',
  '#CCE4F0': '#183658',
  '#C7DFEB': '#19395C',
  '#C2D9E5': '#1A3C60',
  '#A0CDF6': '#1C3E64',
  '#A3D2FB': '#1B3D6B',
  '#A7D5FF': '#1B3D6B',
  '#99C4EB': '#1D4068',
  '#FEFEFE': '#1E2128',
  '#F8FCFF': '#1C2028',
  '#F9FCFF': '#1C2028',
  '#FAFCFF': '#1C2028',
  '#FCFEFF': '#1C2028',
  '#FDFFFF': '#1C2028',

  // Parks / green
  '#B0E5BD': '#1B4D30',
  '#BAE4C4': '#1D5235',
  '#C6E9CE': '#1F573A',
  '#C9E9C8': '#215C3F',
  '#CEE9CE': '#236144',
  '#CEEBD5': '#256649',
  '#E0F1DE': '#276B4E',
  '#EEF3E9': '#2A7053',
  '#9DDEAD': '#2C7558',
  '#98B38F': '#2E7A5D',
  '#CBEFD4': '#1A4A2E',
  '#369F82': '#2A7058',
  '#32B3A0': '#287A68',

  // Roads (light -> dark gray)
  '#FFFFFF': '#2A2D34',
  '#F5F8F7': '#2E3138',
  '#F7F8F5': '#2C2F36',
  '#F7F9F7': '#2C2F36',
  '#F8FAF7': '#2C2F36',
  '#F8F9F6': '#2C2F36',
  '#F8F9F7': '#2C2F36',
  '#F9FAF6': '#2C2F36',
  '#FAFAF7': '#2C2F36',
  '#BFB9BD': '#3A3D44',
  '#B5AFB3': '#3C3F46',
  '#B8B1B5': '#3E4148',
  '#B0A9AE': '#40434A',
  '#AFA7AC': '#42454C',
  '#A79EA4': '#44474E',
  '#AFAFAF': '#464950',

  // Dark text -> light text
  '#1A1A1A': '#C8CCD4',
  '#201F1E': '#C6CAC2',
  '#202020': '#C4C8C0',
  '#252423': '#C2C6BE',
  '#262626': '#C0C4BC',
  '#333333': '#B8BCC4',
  '#343433': '#B6BAA2',
  '#3C332B': '#B4B8A0',
  '#414042': '#B2B69E',
  '#444444': '#B0B49C',
  '#484848': '#AEB29A',
  '#4E4E4E': '#ACB098',
  '#636363': '#949890',
  '#686868': '#90948C',
  '#6E6E7D': '#8C9088',
  '#704747': '#9C8888',
  '#787878': '#888C84',
  '#79798A': '#868A82',
  '#806C62': '#948076',
  '#848484': '#848880',
  '#9B9B9B': '#7C8078',
  '#9CA098': '#7A7E76',
  '#989C94': '#787C74',
  '#949890': '#767A72',
  '#92968E': '#747870',
  '#90948C': '#72766E',
  '#A0A49C': '#70746C',
  '#A08C82': '#948076',
  '#A89494': '#948080',

  // Colored labels (brighten slightly for dark bg)
  '#2388D5': '#5BA8E8',
  '#056FC0': '#4A96D8',
  '#1B7BC4': '#529ED0',
  '#219AB6': '#5BBAD0',
  '#2A76DA': '#5A95E2',
  '#296EC7': '#599EF7',
  '#2A65B2': '#5A95E2',
  '#4672EB': '#76A2FF',
  '#4B6ADC': '#7B9AEC',
  '#5173CD': '#81A3FD',
  '#6995DB': '#99C5FF',
  '#3D5B99': '#6D8BC9',
  '#1A529D': '#4A82CD',
  '#1F4980': '#4F79B0',
  '#5482AA': '#74A2CA',
  '#4A6F8B': '#6A9FB3',
  '#537BA0': '#73A0C0',
  '#4C7193': '#6C9BB8',
  '#587B9B': '#78ABCB',
  '#8195A8': '#A1B5C8',
  '#E81123': '#FF4455',
  '#CC5252': '#FF6B6B',
  '#5572EE': '#7592FF',

  // POI / road-shield oranges (darken to muted amber)
  '#F98745': '#8B6A3F',
  '#F68600': '#8B6A3F',
  '#F96303': '#8B6A3F',
  '#F98744': '#8B6A3F',
  '#EBCD31': '#7A6A28',
  '#EBA24A': '#7A5C38',
  '#EFAA57': '#7A5C38',
  '#FF8C3A': '#7A5C38',
  '#FF9311': '#7A5C38',
  '#FF9712': '#7A5C38',
  '#FF971B': '#7A5C38',
  '#FF9A20': '#7A5C38',
  '#FF9B54': '#7A5C38',
  '#FFA05D': '#7A5C38',
  '#FFA463': '#7A5C38',
  '#FFA63C': '#7A5C38',
  '#FFA840': '#7A5C38',
  '#FFAA44': '#7A5C38',
  '#FFAA6D': '#7A5C38',
  '#FFAB46': '#7A5C38',
  '#FFAD4B': '#7A5C38',
  '#FFAF4E': '#7A5C38',
  '#FFAF77': '#7A5C38',
  '#FFB06D': '#7A5C38',
  '#FFB07A': '#7A5C38',
  '#FFB255': '#7A5C38',
  '#FFB47F': '#7A5C38',
  '#FFB65E': '#7A5C38',
  '#FFB65F': '#7A5C38',
  '#FFB964': '#7A5C38',
  '#FFB987': '#7A5C38',
  '#FFBB69': '#7A5C38',
  '#FFBD6D': '#7A5C38',
  '#FFBD6E': '#7A5C38',
  '#FFBD8E': '#7A5C38',
  '#FFC074': '#7A5C38',
  '#FFC399': '#7A5C38',
  '#FFC48F': '#7A5C38',
  '#FFC783': '#7A5C38',
  '#FFC7A3': '#7A5C38',
  '#FFC988': '#7A5C38',
  '#FFC9A3': '#7A5C38',
  '#FFCDAD': '#7A5C38',
  '#FFD0A3': '#7A5C38',
  '#FFD3A8': '#7A5C38',
  '#FFD5A2': '#7A5C38',
  '#FFD5AD': '#7A5C38',
  '#FFD6AE': '#7A5C38',
  '#FFE69E': '#7A5C38',
  '#FF8834': '#7A5C38',
  '#FF7310': '#7A5C38',
  '#FFC69E': '#7A5C38',
  '#733E17': '#4A3018',
  '#663D21': '#4A3018',
  '#B58C42': '#6B5428',

  // Yellows (darken)
  '#FDE352': '#7A6A28',
  '#FFE769': '#7A6A28',
  '#FFEDA3': '#7A6A28',
  '#FFFC8F': '#7A6A28',
  '#F0D076': '#7A6A28',
  '#F0DD61': '#7A6A28',
  '#F0DF75': '#7A6A28',

  // Pinks (darken)
  '#F194A9': '#6B3A4A',
  '#F29DB0': '#6B3A4A',
  '#F5B4C2': '#6B3A4A',
  '#CA49BB': '#6B3A5B',

  // Red accents
  '#FF4455': '#CC3344',
  '#FF6B6B': '#CC5555',

  // Road halo on dark bg
  '#E4D9D2': '#32353C',
  '#EEDACB': '#3A3530',
  '#EEE0CB': '#3A3530',
  '#EFDDCF': '#3A3530',
  '#E5C7B0': '#3A3530',

  // Pink backgrounds
  '#FFE8E8': '#2A2020',
  '#FFF5EB': '#2A2520'
};

const DARK_COLOR_ENTRIES = Object.entries(DARK_COLOR_MAP).sort((a, b) => b[0].length - a[0].length);

export function applyBingDarkMode(style: StyleSpecification): StyleSpecification {
  let json = JSON.stringify(style);
  for (const [from, to] of DARK_COLOR_ENTRIES) {
    const regex = new RegExp(from.replace('#', '#').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    json = json.replace(regex, to);
  }
  const result = JSON.parse(json) as StyleSpecification;
  for (const layer of result.layers) {
    if (layer.type === 'symbol' && layer.paint && !layer.paint['text-color']) {
      layer.paint['text-color'] = '#C8CCD4';
    }
  }
  return result;
}
