#!/usr/bin/env tsx
/**
 * nearcade — read-only production audit of shop address consistency.
 *
 * Loads MONGODB_URI from .env.prod (never prints it) and inspects every shop
 * for the three inconsistency classes:
 *   1. `address.detailed` (UGC) containing content that is not street-level
 *      address info (phone, hours, URLs, social handles, shop names, …).
 *   2. `address.detailed` duplicating parts of the structured general
 *      address (province/city/district names that already live in
 *      `address.general` / `address.region`).
 *   3. `location.coordinates` disagreeing with the selected general address
 *      (distance from the region centroid chain; implausible bounds).
 *
 * Region semantics mirror src/lib/regions/utils.server.ts where relevant.
 * READ-ONLY. Loads MONGODB_URI from .env.prod and never prints it.
 *
 * Usage:
 *   tsx ./scripts/inspect-shop-addresses.ts            # audit production (.env.prod)
 *   tsx ./scripts/inspect-shop-addresses.ts --env local
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg2 = process.argv.slice(2);
const envIdx = arg2.indexOf('--env');
const ENV_PATH =
  envIdx >= 0
    ? arg2[envIdx + 1] === 'local'
      ? '.env'
      : arg2[envIdx + 1] === 'prod'
        ? '.env.prod'
        : arg2[envIdx + 1] // literal path (e.g. --env .env.local-dump)
    : '.env.prod';
dotenv.config({ path: ENV_PATH, override: true });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Missing MONGODB_URI (expected in .env.prod).');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'data', 'addr-audit');
mkdirSync(OUT_DIR, { recursive: true });

interface Region {
  id: string;
  parentId: string | null;
  level: 'country' | 'province' | 'city' | 'county' | 'street';
  name: Record<string, string>;
  location: { type: 'Point'; coordinates: [number, number] } | null;
}

const haversineKm = (a: [number, number], b: [number, number]): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const la1 = toRad(a[1]);
  const la2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const hasCJK = (s: string) => /[\u4e00-\u9fff]/.test(s);
const endsWithAny = (s: string, suffixes: string[]) => suffixes.some((x) => s.endsWith(x));
const COUNTY_SFX = ['区', '县', '旗', '自治县', '自治旗'];

/** lowercase, parentheses stripped, admin-suffix stripped — for alias compare */
function normName(s: string): string {
  return s
    .replace(/\([^)]*\)/g, '')
    .replace(/[（）]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(
      /\s*(prefecture|metropolis|municipality|metropolitan|province|county|district|borough|township|town|village|state|region|island|city|of america)$/g,
      ''
    )
    .replace(/(特别行政区|自治区|自治州|自治县|自治旗|地区|街道|市|省|区|县|旗|盟)$/g, '')
    .replace(/\s/g, '')
    .trim();
}

/** Levenshtein distance (small strings only). */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

// ── Connection ─────────────────────────────────────────────────────────────

const client = new MongoClient(uri as string, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db();

const regions = await db
  .collection<Region>('regions')
  .find({ level: { $ne: 'street' } })
  .project<Region>({ id: 1, parentId: 1, level: 1, name: 1, location: 1 })
  .toArray();
const byId = new Map(regions.map((r) => [r.id, r]));
const childrenByParentId = new Map<string | null, Region[]>();
for (const r of regions) {
  const bucket = childrenByParentId.get(r.parentId) ?? [];
  bucket.push(r);
  childrenByParentId.set(r.parentId, bucket);
}

const levels: Region['level'][] = ['country', 'province', 'city', 'county', 'street'];

/** norm name → region list (zh + en); used for alias resolution. */
const nameLookup = new Map<string, Region[]>();
for (const r of regions) {
  for (const key of [r.name.zh, r.name.en]) {
    if (!key) continue;
    const n = normName(key);
    const bucket = nameLookup.get(n) ?? [];
    bucket.push(r);
    nameLookup.set(n, bucket);
  }
}

function chainFromIds(ids: string[]): Region[] | null {
  const out: Region[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

function chainFromGeneral(general: string[]): Region[] | null {
  const isZh = hasCJK(general[0] ?? '') || general[0] === '中国';
  const out: Region[] = [];
  let parentId: string | null = null;
  let cursor = 0;
  for (const name of general) {
    let matched: Region | undefined;
    for (let off = 0; cursor + off < levels.length; off++) {
      const lvl = levels[cursor + off];
      const cand = regions.find(
        (r) => r.parentId === parentId && r.level === lvl && (isZh ? r.name.zh : r.name.en) === name
      );
      if (cand) {
        matched = cand;
        cursor = cursor + off + 1;
        break;
      }
    }
    if (!matched) return null;
    out.push(matched);
    parentId = matched.id;
  }
  return out;
}

function appGeneralName(r: Region, isChina: boolean): string {
  if (isChina) return r.name.zh ?? r.name.en ?? r.id;
  return r.name.en ?? r.id;
}

// Chinese-named regions only — used for cross-region text contradiction.
const zhProvinceNames = new Set<string>();
const zhCityNames = new Set<string>();
const zhCountyNames = new Set<string>();
for (const r of regions) {
  if (!r.name.zh) continue;
  const n = r.name.zh;
  if (r.level === 'province' && n.length >= 3) zhProvinceNames.add(n);
  else if (r.level === 'city' && n.length >= 3 && endsWithAny(n, ['市', '州', '盟', '地区']))
    zhCityNames.add(n);
  else if (r.level === 'county' && n.length >= 3 && endsWithAny(n, COUNTY_SFX))
    zhCountyNames.add(n);
}

const shops = await db
  .collection<ShopDoc>('shops')
  .find({}, { projection: { id: 1, name: 1, address: 1, location: 1, isClosed: 1 } })
  .toArray();
console.log(`loaded ${shops.length} shops, ${regions.length} regions`);

// duplicate-coordinate clusters (template/import defaults) — ~100m grid
const coordCount = new Map<string, number>();
for (const s of shops) {
  const c = s.location?.coordinates;
  if (c?.length === 2 && !(c[0] === 0 && c[1] === 0)) {
    const k = `${Math.round(c[0] * 1000) / 1000},${Math.round(c[1] * 1000) / 1000}`;
    coordCount.set(k, (coordCount.get(k) ?? 0) + 1);
  }
}
const topClusters = [...coordCount.entries()]
  .filter(([, n]) => n >= 3)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

// ── Per-shop analysis ──────────────────────────────────────────────────────

interface ShopDoc {
  id: number;
  name: string;
  address?: { general?: string[]; detailed?: string; region?: string[] };
  location?: { coordinates?: [number, number] } | null;
}

interface Flagged {
  id: number;
  name: string;
  general: string[];
  detailed: string;
  region: string[] | null;
  coords: [number, number] | null;
  flags: string[];
}

const all: Flagged[] = [];
const counts: Record<string, number> = {};

for (const shop of shops) {
  const addr = shop.address ?? {};
  const general: string[] = Array.isArray(addr.general) ? addr.general : [];
  const detailed: string = typeof addr.detailed === 'string' ? addr.detailed : '';
  const rawRegion = addr.region;
  const regionIds: string[] | null =
    Array.isArray(rawRegion) && rawRegion.length > 0 && typeof rawRegion[0] === 'string'
      ? (rawRegion as string[])
      : null;
  const coords: [number, number] | null =
    shop.location?.coordinates?.length === 2 ? shop.location.coordinates : null;

  const flags = new Set<string>();
  const det = detailed.trim();
  const detLen = det.length;

  if (general.length === 0 && !regionIds) flags.add('no-general-no-region');
  if (detLen === 0) flags.add('det-empty');

  let chain: Region[] | null = regionIds ? chainFromIds(regionIds) : null;
  if (!chain && general.length > 0) chain = chainFromGeneral(general);
  if (!chain && regionIds && regionIds.length > 0) flags.add('region-ids-unresolvable');

  let leaf: Region | null = null;
  let chainIsChina = false;
  if (chain) {
    leaf = chain[chain.length - 1] ?? null;
    chainIsChina = chain[0]?.id === 'CN';
  }

  // 1. general/region consistency
  if (regionIds && chain) {
    const expected = chain.map((r) => appGeneralName(r, chainIsChina));
    if (expected.join('\u0001') !== general.join('\u0001')) {
      const chainNorms = new Set<string>();
      for (const r of chain) {
        if (r.name.zh) chainNorms.add(normName(r.name.zh));
        if (r.name.en) chainNorms.add(normName(r.name.en));
      }
      const conflictParts: string[] = [];
      const driftParts: string[] = [];
      for (let i = 1; i < Math.max(general.length, chain.length); i++) {
        const g = general[i];
        const e = expected[i];
        if (g === undefined || g === '') {
          driftParts.push('gen-missing');
          continue;
        }
        if (e === undefined) {
          driftParts.push(`gen-only:${g}`);
          continue;
        }
        const gn = normName(g);
        const en = normName(e);
        if (gn === en) continue;
        if (chainNorms.has(gn)) {
          driftParts.push(`"${g}"(alias)`);
          continue;
        }
        if (gn.length >= 5 && [...chainNorms].some((c) => c && lev(gn, c) <= 1)) {
          driftParts.push(`"${g}"(typo)`);
          continue;
        }
        const cands = (nameLookup.get(gn) ?? []).filter((c) => !chain.some((r) => r.id === c.id));
        if (cands.length === 0) {
          driftParts.push(`"${g}"(renamed)`);
          continue;
        }
        // same-country candidates only
        const root = chain[0]?.id;
        const same = cands.filter((c) => {
          let cur: Region | null = c;
          while (cur?.parentId) cur = byId.get(cur.parentId) ?? null;
          return cur?.id === root;
        });
        if (same.length === 0) {
          driftParts.push(`"${g}"(foreign-name)`);
          continue;
        }
        let bestDist: number | null = null;
        for (const c of same) {
          if (c.location?.coordinates && coords) {
            const d = haversineKm(coords, c.location.coordinates);
            if (bestDist === null || d < bestDist) bestDist = d;
          }
        }
        if (bestDist !== null && bestDist < 120) {
          conflictParts.push(`"${g}"→${bestDist.toFixed(0)}km(vs chain "${e}")`);
        } else {
          driftParts.push(
            `"${g}"(moved/${bestDist !== null ? bestDist.toFixed(0) + 'km' : 'no-centroid'})`
          );
        }
      }
      if (conflictParts.length > 0) {
        flags.add(`general-conflict:${conflictParts.slice(0, 3).join('/')}`);
      } else if (driftParts.length > 0) {
        flags.add(`general-drift:${driftParts.slice(0, 3).join('/')}`);
      } else {
        flags.add('general-drift');
      }
    }
    if (leaf && childrenByParentId.has(leaf.id)) flags.add('region-not-terminal');
    if (leaf && !leaf.name.en && chainIsChina === false && leaf.name.zh)
      flags.add(`leaf-en-missing(${leaf.name.zh})`);
  }

  // 2. Detailed address issues (UGC noise)
  if (detLen > 0) {
    if (detLen > 100) flags.add('det-long(>100)');
    else if (detLen > 60) flags.add('det-long(61-100)');
    if (det.includes('\n')) flags.add('det-newline');
    if (/\p{Extended_Pictographic}/u.test(det)) flags.add('det-emoji');
    if (/(1[3-9]\d{9})|(0\d{2,3}[- ]?\d{7,8})|(400[- ]?\d{3}[- ]?\d{4})/.test(det))
      flags.add('det-phone');
    if (/(微信|weixin|VX|vx[:：]?[a-zA-Z0-9]+|QQ[:：]?\d{5,})/i.test(det)) flags.add('det-social');
    if (/https?:\/\/|www\.|\.com\b|\.cn\b|\.net\b/i.test(det)) flags.add('det-url');
    if (
      /(营业时间|营业至|营业中|24小时|全天|周一|星期[一二三四五六日天日]|\d{1,2}[:：]\d{2}(?!\d)|上午|下午|晚上)/.test(
        det
      )
    )
      flags.add('det-hours');
    if (/(电话|联系电话|老板|老板娘)/.test(det)) flags.add('det-contact');
    if (det === shop.name || det.includes(shop.name)) flags.add('det-repeats-name');
  }

  // 3. Duplication of hierarchy names inside detailed (own chain)
  if (detLen > 0 && chain) {
    const hits: string[] = [];
    for (const r of chain) {
      if (r.level === 'country' || r.level === 'street') continue;
      const nz = r.name.zh ?? '';
      const ne = r.name.en ?? '';
      if (nz.length >= 2 && det.includes(nz)) hits.push(nz);
      if (ne && ne.length >= 3 && det.includes(ne)) hits.push(`${ne}(en)`);
    }
    if (hits.length > 0) {
      const uniq = [...new Set(hits)];
      const label = uniq.length >= 2 ? `dup-hierarchy-full` : `dup-hierarchy-one`;
      flags.add(`${label}:${uniq.slice(0, 4).join('/')}`);
    }
  }

  // 4. Cross-region text contradiction — Chinese text vs Chinese-named regions.
  if (detLen > 0 && hasCJK(det)) {
    const own = new Set(chain?.map((r) => r.name.zh ?? '') ?? []);
    const cross: string[] = [];
    for (const n of zhProvinceNames) {
      if (own.has(n)) continue;
      if (det.includes(n)) cross.push(`P:${n}`);
    }
    for (const n of zhCityNames) {
      if (own.has(n)) continue;
      if (det.includes(n)) cross.push(`C:${n}`);
    }
    for (const n of zhCountyNames) {
      if (own.has(n)) continue;
      if (det.includes(n)) cross.push(`D:${n}`);
    }
    if (cross.length > 0) flags.add(`cross-region:${cross.slice(0, 4).join('/')}`);
  }

  // 5. Coordinates vs region
  let leafDist: number | null = null;
  if (coords) {
    if (leaf?.location?.coordinates) {
      leafDist = haversineKm(coords, leaf.location.coordinates);
    } else if (!leaf) {
      flags.add('coords-no-region');
    }
    if (coords[0] === 0 && coords[1] === 0) flags.add('coords-zero');
  } else {
    flags.add('coords-missing');
  }

  if (coords && leaf && leafDist !== null) {
    if (chainIsChina && coords[0] >= 15 && coords[0] <= 55 && coords[1] >= 70 && coords[1] <= 140)
      flags.add('coords-swapped(lng/lat)');
    const threshold: Record<string, number> = {
      street: 25,
      county: 60,
      city: 120,
      province: 200,
      country: 400
    };
    const lim = threshold[leaf.level] ?? 120;
    if (leafDist > lim) {
      flags.add(
        `coords-leaf-mismatch(${leaf.level},${leafDist.toFixed(0)}km>${lim}km,leaf:[${
          leaf.name.zh || leaf.name.en || leaf.id
        }])`
      );
    }
  }

  if (flags.size > 0) {
    all.push({
      id: shop.id,
      name: shop.name,
      general,
      detailed,
      region: regionIds,
      coords,
      flags: [...flags]
    });
  }
}

// ── Output ─────────────────────────────────────────────────────────────────

writeFileSync(
  join(OUT_DIR, 'flagged.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), shops: all }, null, 2)
);

const compact = all
  .map((f) => {
    const g = f.general.length > 0 ? f.general.join('/') : '-';
    const r = f.region ? `ids:${f.region.join('/')}` : '-';
    return `${f.id}\t${f.name}\tgen:[${g}]\treg:[${r}]\tdet:"${f.detailed.replace(/\t/g, ' ').replace(/\n/g, '⏎')}"\tc:${f.coords ? f.coords.join(',') : '-'}\t${f.flags.join(' | ')}`;
  })
  .join('\n');
writeFileSync(join(OUT_DIR, 'flagged.tsv'), compact + '\n');

for (const f of all) {
  for (const fl of f.flags) {
    const bucket = fl.split(/[: (]/)[0];
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
}
console.log('── flag bucket counts ──');
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
for (const [k, v] of sorted) console.log(String(v).padStart(6), k);
console.log('── totals ──');
console.log(`shops=${shops.length} flagged=${all.length}`);
console.log('── top duplicate coordinate clusters (>=3 shops) ──');
for (const [k, n] of topClusters) console.log(String(n).padStart(5), k);
console.log('output: data/addr-audit/flagged.json + flagged.tsv');

await client.close();
