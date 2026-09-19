/// <reference types="node" />

/**
 * Offline regressions for the openmetro integration (§7 of the integration
 * plan). One entry point, three suites, all mocked — no live openmetro API,
 * no real database, no env:
 *
 *   sync      — the actual sync core against a mocked upstream + in-memory
 *               Mongo: version fast-path, hash fallback, schema-version
 *               migration, deterministic ranks, failure metadata.
 *   rankings  — the rankings API: query parser boundaries/invalid input,
 *               in-memory OpenAPI generation, and the real SvelteKit handler
 *               with a mocked Mongo collection.
 *   route     — real routing/assembly/discover/client geometry with external
 *               boundaries stubbed via module hooks.
 *
 * Run: pnpm test:metro
 */
import assert from 'node:assert/strict';
import type { MongoClient } from 'mongodb';

const suites: Array<{ name: string; run: () => Promise<void> }> = [];
const suite = (name: string, run: () => Promise<void>) => suites.push({ name, run });

// ── Suite: sync ─────────────────────────────────────────────────────────────
// No MongoClient is constructed, no app DB/env module is imported, and fetch
// never falls through to the network.
suite('sync', async () => {
  const { GAME_TITLES, METRO_RANKING_RADIUS_OPTIONS, metroRankingSortKey } =
    await import('../src/lib/constants');
  const { shopMetroSchema } = await import('../src/lib/schemas/metro');
  const { runOpenMetroSync } = await import('../src/lib/openmetro/sync.server');

  const baseUrl = 'https://metro-sync-test.invalid';
  const version = '2026-01-01T00:00:00.000Z';
  const names = { zh: '测试', en: 'Test' };
  const routing = { weight: 'time', default_transfer_seconds: 120 };
  const fixtures = ['cn-aa', 'cn-bb'].map((id, index) => {
    const lineId = `${id}-line`;
    const interchangeLineId = `${id}-interchange`;
    const stations = ['a', 'b'].map((suffix, stationIndex) => ({
      id: `${id}-${suffix}`,
      name: `${id}-${suffix}`,
      names,
      location: { lon: 116 + index + stationIndex * 0.1, lat: 40, crs: 'gcj02' },
      status: 'operating',
      lines: stationIndex === 0 ? [lineId, interchangeLineId] : [lineId],
      is_interchange: false
    }));
    const nodes = stations.map((station) => ({
      id: `${station.id}-stop`,
      station_id: station.id,
      line_id: lineId
    }));
    return {
      network: {
        id,
        name: id,
        names,
        city: { id, name: names, country: 'CN', population: null, area: null, location: null },
        country_code: 'CN',
        currency: 'CNY',
        timezone: 'Asia/Shanghai',
        coordinate_system: 'gcj02',
        default_units: { distance: 'km', time: 'seconds', speed: 'km/h' },
        routing
      },
      stations,
      lines: [
        {
          id: lineId,
          name: 'Line',
          names,
          color: '#123456',
          short_name: '1',
          mode: 'metro',
          status: 'operating',
          loop: false
        },
        {
          id: interchangeLineId,
          name: 'Interchange line',
          names,
          color: '#654321',
          short_name: 'X',
          mode: 'metro',
          status: 'operating',
          loop: false
        }
      ],
      patterns: [
        {
          id: `${id}-pattern`,
          line_id: lineId,
          stop_ids: nodes.map((node) => node.id),
          origin_stop_id: nodes[0].id,
          terminal_stop_id: nodes[1].id,
          is_primary: true
        }
      ],
      graph: {
        network_id: id,
        weight: 'seconds',
        routing,
        nodes,
        edges: [
          {
            from: nodes[0].id,
            to: nodes[1].id,
            kind: 'ride',
            line_id: lineId,
            seconds: 180,
            distance_km: 8
          }
        ]
      }
    };
  });

  type Doc = Record<string, unknown>;
  type Filter = Record<string, unknown>;
  const store = new Map<string, Doc[]>();
  const writes: Array<{ collection: string; filter: Filter }> = [];
  const requests: string[] = [];
  const metadataWrites: Doc[] = [];
  let publishVersion = true;
  let failInsert = false;
  const rows = (name: string) => {
    if (!store.has(name)) store.set(name, []);
    return store.get(name)!;
  };
  const matches = (doc: Doc, filter: Filter): boolean =>
    Object.entries(filter).every(([key, value]) => {
      if (value !== null && typeof value === 'object') {
        if ('$ne' in value) return doc[key] !== value.$ne;
        if ('$nin' in value) return !(value.$nin as unknown[]).includes(doc[key]);
        assert.fail(`Unsupported mock filter: ${JSON.stringify(filter)}`);
      }
      return doc[key] === value;
    });
  const replace = (name: string, filter: Filter, replacement: Doc) => {
    writes.push({ collection: name, filter: structuredClone(filter) });
    const documents = rows(name);
    const index = documents.findIndex((doc) => matches(doc, filter));
    if (index < 0) documents.push(structuredClone(replacement));
    else documents[index] = structuredClone(replacement);
    if (name === 'metro_station_rankings' && replacement._id === 'metadata') {
      metadataWrites.push(structuredClone(replacement));
    }
  };
  const remove = (name: string, filter: Filter) => {
    writes.push({ collection: name, filter: structuredClone(filter) });
    store.set(
      name,
      rows(name).filter((doc) => !matches(doc, filter))
    );
  };
  type BulkOp =
    | { replaceOne: { filter: Filter; replacement: Doc; upsert: boolean } }
    | { deleteMany: { filter: Filter } }
    | { updateOne: { filter: Filter; update: { $set?: Doc; $unset?: Doc } } };
  const client = {
    db: () => ({
      collection(name: string) {
        assert.ok(
          [
            'openmetro_networks',
            'metro_stations',
            'metro_lines',
            'metro_patterns',
            'metro_edges',
            'shops',
            'metro_station_rankings'
          ].includes(name)
        );
        return {
          find(filter: Filter) {
            return {
              toArray: async () => structuredClone(rows(name).filter((doc) => matches(doc, filter)))
            };
          },
          async findOne(filter: Filter) {
            return structuredClone(rows(name).find((doc) => matches(doc, filter)) ?? null);
          },
          async replaceOne(filter: Filter, replacement: Doc, options: { upsert: boolean }) {
            assert.equal(options.upsert, true);
            replace(name, filter, replacement);
          },
          async deleteMany(filter: Filter) {
            remove(name, filter);
          },
          async insertMany(documents: Doc[]) {
            assert.equal(name, 'metro_station_rankings');
            if (failInsert) throw new Error('mock ranking insert failure');
            writes.push({ collection: name, filter: {} });
            rows(name).push(...structuredClone(documents));
          },
          async bulkWrite(ops: BulkOp[]) {
            for (const op of ops) {
              if ('replaceOne' in op) {
                assert.equal(op.replaceOne.upsert, true);
                replace(name, op.replaceOne.filter, op.replaceOne.replacement);
              } else if ('deleteMany' in op) {
                remove(name, op.deleteMany.filter);
              } else {
                assert.equal(name, 'shops');
                writes.push({ collection: name, filter: op.updateOne.filter });
                const shop = rows(name).find((doc) => matches(doc, op.updateOne.filter));
                assert.ok(shop);
                const transit = (shop.transit ??= {}) as Doc;
                const update = op.updateOne.update;
                if (update.$set) {
                  assert.deepEqual(Object.keys(update.$set), ['transit.metro']);
                  transit.metro = structuredClone(update.$set['transit.metro']);
                } else {
                  assert.deepEqual(update.$unset, { 'transit.metro': '' });
                  delete transit.metro;
                }
              }
            }
          }
        };
      }
    })
  } as unknown as MongoClient;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, baseUrl, 'All requests must stay on the mocked upstream');
    assert.equal(init?.method ?? 'GET', 'GET');
    assert.ok(init?.signal, 'Keep the upstream timeout');
    requests.push(url.pathname);
    if (url.pathname === '/api/networks') {
      return Response.json({ networks: fixtures.map((fixture) => fixture.network) });
    }
    const fixture = fixtures.find(({ network }) =>
      url.pathname.startsWith(`/api/networks/${network.id}`)
    );
    assert.ok(fixture, `Unexpected upstream request: ${url}`);
    const resource = url.pathname.slice(`/api/networks/${fixture.network.id}`.length);
    if (!resource) {
      return Response.json({
        ...fixture.network,
        ...(publishVersion ? { synced_at: version } : {})
      });
    }
    const key = resource.slice(1);
    assert.ok(key === 'stations' || key === 'lines' || key === 'patterns' || key === 'graph');
    if (key === 'graph') assert.equal(url.searchParams.get('weight'), 'time');
    return Response.json(fixture[key]);
  };

  const referenceCollections = [
    'openmetro_networks',
    'metro_stations',
    'metro_lines',
    'metro_patterns',
    'metro_edges'
  ];
  const referenceWrites = () =>
    writes.filter((write) => referenceCollections.includes(write.collection));
  const resetActivity = () => {
    writes.length = 0;
    requests.length = 0;
    metadataWrites.length = 0;
  };
  const sync = (force = false) => runOpenMetroSync({ client, baseUrl, force });
  const rankings = () =>
    rows('metro_station_rankings').filter(
      (row) => row._id !== 'metadata'
    ) as unknown as import('../src/lib/schemas/metro').MetroStationRanking[];
  const metadata = () => rows('metro_station_rankings').find((row) => row._id === 'metadata')!;
  const shop = (id: number) => {
    const result = rows('shops').find((row) => row.id === id);
    assert.ok(result);
    return result;
  };
  const assignment = (id: number) =>
    (shop(id).transit as { metro?: import('../src/lib/schemas/metro').ShopMetro }).metro;
  const atStation = (id: number, networkIndex: number, stationIndex: number, quantity = 1): Doc => {
    const { lon, lat } = fixtures[networkIndex].stations[stationIndex].location;
    return {
      id,
      location: { coordinates: [lon, lat] },
      games: [{ titleId: GAME_TITLES[0].id, quantity }]
    };
  };
  const assertFastPath = () => {
    assert.deepEqual(requests, [
      '/api/networks',
      ...fixtures.map(({ network }) => `/api/networks/${network.id}`)
    ]);
    assert.equal(
      referenceWrites().length,
      0,
      'Unchanged networks must not write any reference collection'
    );
  };
  const assertPublished = () => {
    assert.equal(metadataWrites.length, 2, 'Rankings must enter calculating then finish');
    assert.equal(metadataWrites[0].isCalculating, true);
    assert.equal(metadata().isCalculating, false);
    assert.ok((metadata().expiresAt as Date).getTime() > Date.now());
    assert.equal(metadata().totalCount, rankings().length);
  };

  try {
    // Populate every reference collection via the real forced persistence path, in memory only.
    store.set('shops', [atStation(1, 0, 0), atStation(2, 0, 1), atStation(3, 1, 0)]);
    await sync(true);
    assert.equal(rankings().length, 3);
    assert.deepEqual(
      shopMetroSchema.parse(assignment(1)).lines.map((line) => line.shortName),
      ['1', 'X']
    );
    const previousNetworks = structuredClone(metadata().networks);
    resetActivity();

    // Same upstream version; game edit, relocation, shop addition, and loss of coordinates.
    shop(1).games = [{ titleId: GAME_TITLES[0].id, quantity: 7 }];
    shop(2).location = atStation(2, 0, 0).location;
    shop(3).location = null;
    rows('shops').push(atStation(4, 1, 1, 2));
    const result = await sync();
    assertFastPath();
    assertPublished();
    assert.deepEqual(result.progress, { processed: 4, total: 4 });
    assert.equal(result.summary.assignedCount, 3);
    assert.equal(result.summary.unassignedCount, 1);
    assert.equal(result.summary.updatedShops, 3);
    assert.equal(result.summary.rankingCount, 2);
    assert.equal(assignment(2)?.stationId, 'cn-aa-a');
    assert.equal(assignment(3), undefined);
    assert.equal(assignment(4)?.stationId, 'cn-bb-b');
    assert.deepEqual(
      rankings()
        .map((row) => row.stationId)
        .sort(),
      ['cn-aa-a', 'cn-bb-b']
    );
    // Per-radius metrics (campus parity): every row carries METRO_RANKING_RADIUS_OPTIONS
    // entries and a rankOrder key per (sortBy, radius) pair.
    const first = rankings().find((row) => row.stationId === 'cn-aa-a')!;
    assert.deepEqual(
      first.rankings.map((entry) => entry.radius),
      [...METRO_RANKING_RADIUS_OPTIONS]
    );
    for (const sortBy of ['shops', 'machines', GAME_TITLES[0].key]) {
      for (const radius of METRO_RANKING_RADIUS_OPTIONS) {
        assert.equal(typeof first.rankOrder[metroRankingSortKey(sortBy, radius)], 'number');
      }
    }
    // Station cn-aa-a: shop 1 (7 machines) and relocated shop 2 (1 machine) sit
    // on the station itself; shop 3 has no coordinates so it counts nowhere.
    const assigned = first.rankings.find(
      (entry) => entry.radius === METRO_RANKING_RADIUS_OPTIONS[0]
    )!;
    assert.equal(assigned.shopCount, 2);
    assert.equal(assigned.totalMachines, 8);
    const gameMetrics = assigned.gameSpecificMachines.find(
      (entry) => entry.name === GAME_TITLES[0].key
    );
    assert.equal(gameMetrics?.quantity, 8);
    // Station cn-bb-b holds only shop 4 (2 machines); the fixture stations are
    // 0.1 degrees apart (~8 km), so shop 4 stays outside cn-bb-a's 0.2 km too.
    const second = rankings().find((row) => row.stationId === 'cn-bb-b')!;
    assert.equal(second.rankings[0].shopCount, 1);
    assert.equal(second.rankings[0].totalMachines, 2);
    assert.equal(
      second.rankOrder[metroRankingSortKey('shops', METRO_RANKING_RADIUS_OPTIONS[0])],
      2
    );
    assert.equal(first.rankOrder[metroRankingSortKey('shops', METRO_RANKING_RADIUS_OPTIONS[0])], 1);
    assert.deepEqual(metadataWrites[0].networks, previousNetworks);
    assert.deepEqual(
      metadata().networks,
      fixtures.map(({ network }) => ({
        id: network.id,
        name: network.name,
        names: network.names,
        stationCount: 1
      }))
    );
    console.log(
      '  ✓ Unchanged upstream: no reference fetch/writes; shop/game edits refresh assignments, metrics and metadata.'
    );

    // Shop deletion must also remove obsolete station rankings.
    store.set(
      'shops',
      rows('shops').filter((row) => row.id !== 4)
    );
    resetActivity();
    await sync();
    assertFastPath();
    assert.equal(rankings().length, 1);

    // Every primary sort ties (including absent games); input order must not assign the ranks.
    store.set('shops', [
      atStation(4, 1, 1),
      atStation(3, 1, 0),
      atStation(2, 0, 1),
      atStation(1, 0, 0)
    ]);
    const sortKeys = ['shops', 'machines', ...GAME_TITLES.map((game) => game.key)];
    const expectedIds = ['cn-aa:cn-aa-a', 'cn-aa:cn-aa-b', 'cn-bb:cn-bb-a', 'cn-bb:cn-bb-b'];
    for (let pass = 0; pass < 2; pass++) {
      resetActivity();
      await sync();
      assertFastPath();
      for (const key of sortKeys) {
        for (const radius of METRO_RANKING_RADIUS_OPTIONS) {
          const sortKey = metroRankingSortKey(key, radius);
          const ordered = [...rankings()].sort(
            (a, b) => a.rankOrder[sortKey] - b.rankOrder[sortKey]
          );
          assert.deepEqual(
            ordered.map((row) => row._id),
            expectedIds,
            `Tie order for ${sortKey}`
          );
          assert.deepEqual(
            ordered.map((row) => row.rankOrder[sortKey]),
            [1, 2, 3, 4]
          );
        }
      }
      rows('shops').reverse();
      rows('metro_stations').reverse();
    }
    console.log(
      '  ✓ Deletion refreshes rankings; every sort key has deterministic global tied ranks across reversed reads.'
    );

    resetActivity();
    await sync(true);
    assert.equal(requests.length, 11, 'Force fetches every reference endpoint');
    for (const name of referenceCollections) {
      for (const { network } of fixtures) {
        assert.ok(
          referenceWrites().some(
            (write) =>
              write.collection === name &&
              (write.filter._id === network.id || write.filter.networkId === network.id)
          ),
          `${name}: ${network.id} forced persistence`
        );
      }
    }
    assertPublished();

    // One outdated schema must persist, without rewriting the other unchanged network.
    rows('openmetro_networks')[1].schemaVersion = 2;
    resetActivity();
    await sync();
    assert.equal(requests.length, 7);
    assert.ok(referenceWrites().length > 0);
    assert.ok(
      referenceWrites().every((write) =>
        String(write.filter.networkId ?? write.filter._id).startsWith('cn-bb')
      )
    );
    assert.equal(rows('openmetro_networks')[1].schemaVersion, 3);
    assertPublished();

    // APIs lacking synced_at take the hash fallback but still skip unchanged reference writes.
    publishVersion = false;
    resetActivity();
    await sync();
    assert.equal(requests.length, 11);
    assert.equal(referenceWrites().length, 0);
    assertPublished();
    publishVersion = true;
    console.log(
      '  ✓ Forced persistence, mixed-network schema migration and unchanged hash fallback.'
    );

    const publishedNetworks = structuredClone(metadata().networks);
    failInsert = true;
    resetActivity();
    await assert.rejects(() => sync(), /mock ranking insert failure/);
    assertFastPath();
    assert.equal(metadataWrites[0].isCalculating, true);
    assert.deepEqual(metadataWrites[0].networks, publishedNetworks);
    assert.equal(metadata().isCalculating, false);
    assert.ok((metadata().expiresAt as Date).getTime() < Date.now());
    assert.deepEqual(metadata().networks, publishedNetworks);

    // No previous metadata: current network identities must still survive calculating/failure.
    store.set('metro_station_rankings', []);
    resetActivity();
    await assert.rejects(() => sync(), /mock ranking insert failure/);
    const fallbackNetworks = fixtures.map(({ network }) => ({
      id: network.id,
      name: network.name,
      names: network.names,
      stationCount: 0
    }));
    assert.deepEqual(metadataWrites[0].networks, fallbackNetworks);
    assert.deepEqual(metadata().networks, fallbackNetworks);
    console.log(
      '  ✓ Calculating/failure metadata preserves networks, including first-run fallback.'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Suite: rankings ─────────────────────────────────────────────────────────
suite('rankings', async () => {
  const { fileURLToPath } = await import('node:url');
  const { error, isHttpError, redirect } = await import('@sveltejs/kit');
  const { createServer } = await import('vite');
  const { createDocument } = await import('zod-openapi');
  const { GAME_TITLES, PAGINATION, METRO_RANKING_RADIUS_OPTIONS, metroRankingSortKey } =
    await import('../src/lib/constants');
  const { metroRankingQuerySchema, metroRankingResponseSchema } =
    await import('../src/lib/schemas/metro');
  type MetroStationRanking = import('../src/lib/schemas/metro').MetroStationRanking;
  const { parseQueryOrError } = await import('../src/lib/utils/validation.server');
  const openapi = (await import('../src/routes/api/rankings/metro/openapi')).default;

  const urlFor = (query = '') => new URL(`http://localhost/api/rankings/metro${query}`);
  const parse = (query = '') => parseQueryOrError(metroRankingQuerySchema, urlFor(query));
  assert.deepEqual(parse(), { sortBy: 'shops', radius: 2, limit: PAGINATION.RANKING_PAGE_SIZE });
  for (const networkId of ['', '   ']) {
    assert.equal(parse(`?networkId=${encodeURIComponent(networkId)}`).networkId, undefined);
  }
  assert.equal(parse('?networkId=%20cn-bj%20').networkId, 'cn-bj');
  for (const sortBy of ['shops', 'machines', ...GAME_TITLES.map((game) => game.key)]) {
    assert.equal(parse(`?sortBy=${sortBy}`).sortBy, sortBy);
  }
  for (const radius of METRO_RANKING_RADIUS_OPTIONS) {
    assert.equal(parse(`?radius=${radius}`).radius, radius);
  }
  assert.equal(parse('?radius=0.2').radius, 0.2);
  assert.equal(parse('?limit=100').limit, 100);
  assert.equal(parse('?limit=').limit, PAGINATION.RANKING_PAGE_SIZE);
  assert.equal(parse('?after=9007199254740991').after, '9007199254740991');
  const invalid = [
    ...['0', '-1', '1.5', '101', 'Infinity', 'NaN', '9007199254740992', '2junk', ' '].map(
      (value) => ['limit', value]
    ),
    ...[
      '',
      '0',
      '-1',
      '1.5',
      '01',
      '1e2',
      '0x10',
      '+1',
      ' 1',
      '1 ',
      '1junk',
      'Infinity',
      '9007199254740992'
    ].map((value) => ['after', value]),
    ...['CN-BJ', 'cn.bj', '$ne', 'cn/bj', '-cn-bj', 'cn-bj-', 'cn--bj'].map((value) => [
      'networkId',
      value
    ]),
    ['sortBy', ''],
    ['sortBy', 'unknown'],
    ['sortBy', 'shops.$gt'],
    ['radius', '0'],
    ['radius', '-5'],
    ['radius', '2.5'],
    ['radius', '5'],
    ['radius', '30'],
    ['radius', 'abc'],
    ['radius', 'shops.$gt']
  ];
  for (const [key, value] of invalid) {
    assert.throws(
      () => parse(`?${key}=${encodeURIComponent(value)}`),
      (err) => isHttpError(err, 400)
    );
  }
  console.log(
    `  ✓ Parser: defaults, all sort keys, boundaries and ${invalid.length} invalid queries.`
  );

  // Generate only this path in memory; do not touch static/openapi.json.
  const document = createDocument({
    openapi: '3.0.0',
    info: { title: 'Metro rankings validation', version: '1' },
    paths: { '/rankings/metro': openapi.pathItem }
  });
  assert.equal(document.paths?.['/rankings/metro']?.get?.parameters?.length, 5);
  console.log('  ✓ OpenAPI: shared input/output schemas generate successfully.');

  const sortKeys = ['shops', 'machines', ...GAME_TITLES.map((game) => game.key)];
  const rows: MetroStationRanking[] = [1, 2, 3, 4, 5].map((rank) => ({
    id: `cn-bj:station-${rank}`,
    _id: `cn-bj:station-${rank}`,
    networkId: rank % 2 ? 'cn-bj' : 'cn-sh',
    stationId: `station-${rank}`,
    name: `Station ${rank}`,
    names: { zh: `站${rank}`, en: `Station ${rank}` },
    lines: [],
    location: { lon: 116, lat: 40 },
    rankings: METRO_RANKING_RADIUS_OPTIONS.map((radius) => ({
      radius,
      shopCount: 1,
      totalMachines: 1,
      areaDensity: 1 / (Math.PI * radius * radius),
      machinesPerCapita: null,
      gameSpecificMachines: [{ name: GAME_TITLES[0].key, quantity: 1 }]
    })),
    rankOrder: Object.fromEntries(
      sortKeys.flatMap((key) =>
        METRO_RANKING_RADIUS_OPTIONS.map((radius) => [
          metroRankingSortKey(key, radius),
          key === 'shops' ? rank : 6 - rank
        ])
      )
    )
  }));
  const networks = [
    {
      id: 'cn-bj',
      name: '北京地铁',
      names: { zh: '北京地铁', en: 'Beijing Subway' },
      stationCount: 3
    },
    {
      id: 'cn-sh',
      name: '上海地铁',
      names: { zh: '上海地铁', en: 'Shanghai Metro' },
      stationCount: 2
    }
  ];
  const initialMetadata = {
    _id: 'metadata',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    totalCount: 5,
    networks
  };
  let metadata:
    | (Omit<typeof initialMetadata, 'networks'> & {
        networks?: typeof networks;
        isCalculating?: boolean;
      })
    | null = initialMetadata;
  let documents = rows;
  let failure: unknown;
  let reads = 0;
  type Filter = { _id: { $ne: string }; networkId?: string } & Record<string, unknown>;
  const matches = (row: MetroStationRanking, filter: Filter) => {
    assert.deepEqual(filter._id, { $ne: 'metadata' });
    return (
      (!filter.networkId || row.networkId === filter.networkId) &&
      Object.entries(filter).every(
        ([key, condition]) =>
          !key.startsWith('rankOrder.') ||
          row.rankOrder[key.slice('rankOrder.'.length)] > (condition as { $gt: number }).$gt
      )
    );
  };
  const collection = {
    async findOne(filter: unknown) {
      reads++;
      assert.deepEqual(filter, { _id: 'metadata' });
      if (failure) throw failure;
      return metadata;
    },
    async countDocuments(filter: Filter) {
      assert.ok(!Object.keys(filter).some((key) => key.startsWith('rankOrder.')));
      return documents.filter((row) => matches(row, filter)).length;
    },
    find(filter: Filter) {
      let result = documents.filter((row) => matches(row, filter));
      return {
        sort(order: Record<string, number>) {
          const [[key, direction]] = Object.entries(order);
          assert.equal(direction, 1);
          const sortBy = key.slice('rankOrder.'.length);
          result.sort((a, b) => a.rankOrder[sortBy] - b.rankOrder[sortBy]);
          return this;
        },
        limit(limit: number) {
          assert.ok(limit >= 2 && limit <= 101);
          result = result.slice(0, limit);
          return this;
        },
        async toArray() {
          return result;
        }
      };
    }
  };

  // Load the actual SvelteKit handler while replacing only its Mongo dependency.
  const mockId = '\0metro-ranking-test-db';
  const server = await createServer({
    configFile: false,
    resolve: {
      alias: [
        { find: '$lib/db/index.server', replacement: mockId },
        { find: '$lib', replacement: fileURLToPath(new URL('../src/lib', import.meta.url)) }
      ]
    },
    plugins: [
      {
        name: 'metro-ranking-test-db',
        resolveId(id) {
          if (id === mockId) return mockId;
        },
        load(id) {
          if (id === mockId)
            return 'let db; export const setDb = (value) => { db = value }; export default { db: () => db };';
        }
      }
    ],
    server: { middlewareMode: true, watch: null, hmr: false }
  });
  try {
    const mock = await server.ssrLoadModule(mockId);
    mock.setDb({
      collection(name: string) {
        assert.equal(name, 'metro_station_rankings');
        return collection;
      }
    });
    const { GET } = await server.ssrLoadModule('/src/routes/api/rankings/metro/+server.ts');
    const get = async (query = '') => {
      const response: Response = await GET({ url: urlFor(query) });
      assert.equal(response.status, 200);
      return metroRankingResponseSchema.parse(await response.json());
    };
    const first = await get('?networkId=cn-bj&limit=2');
    assert.deepEqual(
      first.data.map((row) => row.rankOrder[metroRankingSortKey('shops', 2)]),
      [1, 3]
    );
    assert.deepEqual(
      first.data[0].rankings.map((entry) => entry.radius),
      [...METRO_RANKING_RADIUS_OPTIONS]
    );
    assert.equal(first.totalCount, 3);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextCursor, '3');
    assert.deepEqual(first.networks, networks);
    assert.equal(first.cached, true);
    assert.equal(first.stale, false);
    assert.equal(first.calculating, false);
    assert.equal(first.cacheTime, initialMetadata.createdAt.toISOString());
    const last = await get('?networkId=cn-bj&limit=2&after=3');
    assert.deepEqual(
      last.data.map((row) => row.rankOrder[metroRankingSortKey('shops', 2)]),
      [5]
    );
    assert.equal(last.totalCount, 3);
    assert.equal(last.hasMore, false);
    assert.equal(last.nextCursor, null);
    const beyond = await get('?networkId=cn-bj&after=9007199254740991');
    assert.equal(beyond.data.length, 0);
    assert.equal(beyond.totalCount, 3);
    assert.equal(beyond.nextCursor, null);
    for (const sortBy of sortKeys) {
      for (const radius of METRO_RANKING_RADIUS_OPTIONS) {
        const result = await get(`?sortBy=${sortBy}&radius=${radius}&limit=2&after=2`);
        const key = metroRankingSortKey(sortBy, radius);
        assert.deepEqual(
          result.data.map((row) => row.rankOrder[key]),
          [3, 4]
        );
        assert.equal(result.nextCursor, '4');
        assert.equal(result.totalCount, 5);
      }
    }
    const exact = await get('?networkId=cn-sh&limit=2');
    assert.equal(exact.hasMore, false);
    assert.equal(exact.nextCursor, null);
    const unknown = await get('?networkId=cn-unknown');
    assert.equal(unknown.totalCount, 0);
    assert.deepEqual(unknown.data, []);
    assert.deepEqual(unknown.networks, networks);
    assert.equal((await get('?networkId=')).totalCount, 5);
    metadata = {
      ...initialMetadata,
      expiresAt: new Date(0),
      isCalculating: true,
      networks: undefined
    };
    const stale = await get();
    assert.equal(stale.stale, true);
    assert.equal(stale.calculating, true);
    assert.deepEqual(stale.networks, []);
    documents = [];
    assert.equal((await get()).totalCount, 0);
    metadata = null;
    assert.deepEqual(await get(), {
      data: [],
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      cached: false,
      cacheTime: null,
      stale: true,
      calculating: true,
      networks: []
    });
    const readsBeforeInvalid = reads;
    await assert.rejects(
      () => GET({ url: urlFor('?after=0') }),
      (err) => isHttpError(err, 400)
    );
    assert.equal(reads, readsBeforeInvalid);
    for (const makeError of [() => error(503, 'unavailable'), () => redirect(307, '/retry')]) {
      try {
        makeError();
      } catch (err) {
        failure = err;
      }
      await assert.rejects(
        () => GET({ url: urlFor() }),
        (err) => err === failure
      );
    }
    failure = new Error('simulated Mongo failure');
    const originalConsoleError = console.error;
    try {
      console.error = () => {};
      await assert.rejects(
        () => GET({ url: urlFor() }),
        (err) => isHttpError(err, 500)
      );
    } finally {
      console.error = originalConsoleError;
    }
    console.log(
      '  ✓ Handler: filtered/global pagination, all sort keys, totals, cache states and errors.'
    );
  } finally {
    await server.close();
  }
});

// ── Suite: route ────────────────────────────────────────────────────────────
suite('route', async () => {
  const { registerHooks } = await import('node:module');
  const { assembleMetroBlock, buildShopItinerary } =
    await import('../src/lib/openmetro/route.server');
  type MetroShopItinerary = import('../src/lib/openmetro/route.server').MetroShopItinerary;
  const { snapToStation, runMetroDijkstra, computeWalkSeconds } =
    await import('../src/lib/openmetro/graph.server');
  type MetroSnapshot = import('../src/lib/openmetro/snapshot.server').MetroSnapshot;
  type MetroEdgeDoc = import('../src/lib/openmetro/schemas').MetroEdgeDoc;
  type MetroStationDoc = import('../src/lib/openmetro/schemas').MetroStationDoc;
  const { discoverMetroBlockSchema } = await import('../src/lib/schemas/metro');
  const { shopSchema } = await import('../src/lib/schemas/shops');
  const { METRO_ENTRY_OVERHEAD_SECONDS, METRO_EXIT_OVERHEAD_SECONDS } =
    await import('../src/lib/constants');

  const network = {
    id: 'test-network',
    name: 'Test network',
    names: { zh: '测试网络', en: 'Test network' },
    cityRegionId: 'CN'
  };
  const stations: MetroStationDoc[] = ['a', 'x', 'b'].map((id, i) => ({
    _id: id,
    networkId: network.id,
    name: id,
    names: { zh: id, en: id },
    lon: 116 + i * 0.01,
    lat: 40,
    status: 'operating',
    lineIds: [],
    isInterchange: id === 'x'
  }));
  const edges: MetroEdgeDoc[] = [
    {
      from: 'a1',
      to: 'x1',
      fromStationId: 'a',
      toStationId: 'x',
      kind: 'ride',
      lineId: 'L1',
      seconds: 300
    },
    {
      from: 'x1',
      to: 'x2',
      fromStationId: 'x',
      toStationId: 'x',
      kind: 'transfer',
      lineId: null,
      seconds: 120
    },
    {
      from: 'x2',
      to: 'b2',
      fromStationId: 'x',
      toStationId: 'b',
      kind: 'ride',
      lineId: 'L2',
      seconds: 300
    }
  ].map((edge, i) => ({
    ...edge,
    _id: String(i),
    networkId: network.id,
    distanceKm: null
  })) as MetroEdgeDoc[];
  const snapshot: MetroSnapshot = {
    versionMs: 0,
    networks: [network],
    stations,
    operatingStations: stations,
    stationsById: new Map(stations.map((station) => [station._id, station])),
    linesById: new Map(),
    patternsByLine: new Map(),
    adjacency: new Map(edges.map((edge) => [edge.from, [edge]])),
    stopStation: new Map([
      ['a1', 'a'],
      ['x1', 'x'],
      ['x2', 'x'],
      ['b2', 'b']
    ]),
    stopsByStation: new Map([
      ['a', ['a1']],
      ['x', ['x1', 'x2']],
      ['b', ['b2']]
    ])
  };
  const searchOrigin = { lon: 115.996, lat: 40.003 };
  const shops = [120, 1040].map((walkSeconds, i) =>
    shopSchema.parse({
      _id: String(i + 1),
      id: i + 1,
      name: `Shop ${i + 1}`,
      comment: '',
      address: {},
      openingHours: [
        [
          { hour: 0, minute: 0 },
          { hour: 23, minute: 59 }
        ]
      ],
      games: [],
      location: { type: 'Point', coordinates: [116.1 + i * 0.01, 40] },
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:00.000Z',
      transit: {
        metro: {
          networkId: network.id,
          stationId: 'b',
          stationName: 'b',
          names: { zh: 'b', en: 'b' },
          walkSeconds,
          distanceKm: 1,
          lines: [
            {
              id: 'L1',
              name: 'Line 1',
              names: { zh: '1号线', en: 'Line 1' },
              color: '#123456',
              shortName: '1'
            },
            {
              id: 'L2',
              name: 'Line 2',
              names: { zh: '2号线', en: 'Line 2' },
              color: '#654321',
              shortName: '2'
            }
          ]
        }
      }
    })
  );
  const expectedLegs = [
    { kind: 'ride', lineId: 'L1', stationIds: ['a', 'x'], seconds: 300 },
    { kind: 'transfer', stationIds: ['x'], seconds: 120 },
    { kind: 'ride', lineId: 'L2', stationIds: ['x', 'b'], seconds: 300 }
  ];

  const origin = snapToStation(stations, searchOrigin.lat, searchOrigin.lon);
  const dijkstra = runMetroDijkstra(snapshot, 'a');
  assert.ok(origin);
  assert.ok(dijkstra);
  const stationTotal =
    computeWalkSeconds(origin.distanceKm) +
    METRO_ENTRY_OVERHEAD_SECONDS +
    720 +
    METRO_EXIT_OVERHEAD_SECONDS;
  const templates: MetroShopItinerary[] = [];
  const assemblyInputs: Parameters<typeof assembleMetroBlock>[0][] = [];

  // Intercept only external/framework boundaries; routing, query/response schemas,
  // endpoint candidate/cache handling and client geometry all execute real code.
  // No real DB module, attendance service, coordinate API or fare client is loaded.
  const unexpected = () => {
    throw new Error('Unexpected external service call');
  };
  const boundary = {
    mongo: {
      db: () => ({
        collection: (name: string) => {
          assert.equal(name, 'shops');
          return { find: () => ({ toArray: async () => shops }) };
        }
      })
    },
    snapshot,
    buildShopItinerary: (...args: Parameters<typeof buildShopItinerary>) => {
      const itinerary = buildShopItinerary(...args);
      if (itinerary) {
        for (const leg of itinerary.legs) {
          Object.freeze(leg.stationIds);
          Object.freeze(leg);
        }
        Object.freeze(itinerary.legs);
        Object.freeze(itinerary);
        templates.push(itinerary);
      }
      return itinerary;
    },
    assembleMetroBlock: (input: Parameters<typeof assembleMetroBlock>[0]) => {
      assemblyInputs.push(input);
      return assembleMetroBlock(input);
    },
    unexpected
  };
  const globals = globalThis as typeof globalThis & { __metroRouteTest?: typeof boundary };
  globals.__metroRouteTest = boundary;
  const stubs: Record<string, string> = {
    '$lib/db/index.server': 'export default globalThis.__metroRouteTest.mongo;',
    '$lib/openmetro/snapshot.server':
      'export const getMetroSnapshot = async () => globalThis.__metroRouteTest.snapshot;',
    '$lib/openmetro/route.server':
      'export const { buildShopItinerary, assembleMetroBlock } = globalThis.__metroRouteTest;',
    '$lib/utils': `export const calculateDistance = () => 10;
      export const toPlainObject = (doc) => JSON.parse(JSON.stringify(doc, (_, value) => value instanceof Date ? value.toISOString() : value));
      export const getShopOpeningHours = globalThis.__metroRouteTest.unexpected;
      export const getShopTimezone = globalThis.__metroRouteTest.unexpected;`,
    '$lib/utils/region.server': 'export const expandShopsRegions = async (shops) => shops;',
    './attendance.server':
      'export const getShopsAttendanceData = globalThis.__metroRouteTest.unexpected;',
    '$app/paths': 'export const base = "";',
    '$env/dynamic/private': 'export const env = {};',
    '$env/dynamic/public': 'export const env = {};',
    '$lib/paraglide/messages': `export const m = new Proxy({}, { get: (_, key) => () => String(key) });`,
    'openmetro-client': 'export const createClient = globalThis.__metroRouteTest.unexpected;'
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const source = stubs[specifier];
      return source === undefined
        ? nextResolve(specifier, context)
        : {
            url: `data:text/javascript,${encodeURIComponent(source)}`,
            shortCircuit: true
          };
    }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = unexpected;

  try {
    const { loadShops } = await import('../src/lib/endpoints/discover.server');
    const { buildMetroOverlay, buildMetroFullPath, buildMetroTransitPlan, getMetroShopLines } =
      await import('../src/lib/utils/metro.client');
    assert.deepEqual(
      getMetroShopLines(shops[0], undefined).map((line) => line.shortName),
      ['1', '2']
    );
    const load = (lon: number, lat: number) =>
      loadShops({
        url: new URL(
          `https://offline.invalid/api/discover?longitude=${lon}&latitude=${lat}&radius=0&fetchAttendance=false&includeTimeInfo=false`
        )
      });
    const response = await load(searchOrigin.lon, searchOrigin.lat);
    assert.ok(response.metro);
    const block = discoverMetroBlockSchema.parse(response.metro);

    // Two shops share one frozen station template, not a mutable total.
    assert.equal(templates.length, 1, 'station path must only be reconstructed once');
    assert.equal(templates[0].totalSeconds, stationTotal, 'cached zero-egress total is untouched');
    assert.deepEqual(templates[0].legs, expectedLegs);
    assert.equal(response.shops.length, 2);
    for (const shop of response.shops) {
      const itinerary = block.shops[String(shop.id)];
      assert.equal(itinerary.totalSeconds, stationTotal + shop.transit!.metro!.walkSeconds);
      assert.equal(itinerary.totalSeconds, shop.travel?.seconds);
      assert.equal(shop.travel?.metroSeconds, 720);
      assert.equal(itinerary.rideSeconds, 600);
      assert.equal(itinerary.transferCount, 1);
      assert.deepEqual(itinerary.legs, expectedLegs);
      const embedded = assemblyInputs[0].assignedShops.find(
        (entry) => entry.id === shop.id
      )!.itinerary;
      assert.notEqual(embedded, templates[0]);
      assert.equal(embedded.legs, templates[0].legs, 'unchanged legs may be shared');
    }
    assert.notEqual(
      assemblyInputs[0].assignedShops[0].itinerary,
      assemblyInputs[0].assignedShops[1].itinerary
    );
    assert.equal(block.shops['2'].totalSeconds - block.shops['1'].totalSeconds, 920);
    console.log('  ✓ Two shops share one frozen station template, not a mutable total.');

    // Actual origin → station access path survives assembly and client rendering.
    assert.equal(block.origin.lon, response.location.longitude);
    assert.equal(block.origin.lat, response.location.latitude);
    assert.deepEqual(block.stations.a, {
      name: 'a',
      names: { zh: 'a', en: 'a' },
      lon: 116,
      lat: 40
    });
    assert.ok(block.origin.walkSeconds > 0);
    for (const shop of response.shops) {
      const accessPath = [
        [searchOrigin.lon, searchOrigin.lat],
        [116, 40]
      ];
      const overlay = buildMetroOverlay(shop, block);
      assert.equal(overlay[0].kind, 'walk');
      assert.equal(overlay[0].dashed, true);
      assert.deepEqual(overlay[0].path, accessPath);
      assert.notDeepEqual(overlay[0].path[0], overlay[0].path[1]);
      assert.deepEqual(buildMetroFullPath(shop, block).slice(0, 2), accessPath);
      const plan = buildMetroTransitPlan(shop, block);
      assert.ok(plan);
      assert.equal(plan.time, shop.travel?.seconds);
      // The plan total must reconcile with its own steps: the entry/exit
      // overheads are folded into the first/last ride segments (never into
      // walk segments, so a zero-metre walk never reads "0m · 4min").
      const stepSum = plan.segments.reduce((sum, segment) => sum + segment.time, 0);
      assert.equal(stepSum, plan.time);
      assert.deepEqual(
        plan.segments.map((segment) => segment.time),
        [
          block.origin.walkSeconds,
          300 + METRO_ENTRY_OVERHEAD_SECONDS,
          120,
          300 + METRO_EXIT_OVERHEAD_SECONDS,
          shop.transit!.metro!.walkSeconds
        ]
      );
      assert.deepEqual(plan.segments[0].transit.path, [
        { lng: searchOrigin.lon, lat: searchOrigin.lat },
        { lng: 116, lat: 40 }
      ]);
    }
    console.log('  ✓ Actual origin → station access path survives assembly and client rendering.');

    // Origin exactly at station retains zero access walk.
    const atStation = await load(116, 40);
    assert.ok(atStation.metro);
    assert.equal(atStation.metro.origin.walkSeconds, 0);
    assert.deepEqual(buildMetroOverlay(atStation.shops[0], atStation.metro)[0].path, [
      [116, 40],
      [116, 40]
    ]);
    console.log('  ✓ Origin exactly at station retains zero access walk.');

    // No assigned shops still omits the metro block.
    assert.equal(
      assembleMetroBlock({
        snapshot,
        origin: origin!,
        originCoordinates: searchOrigin,
        network,
        assignedShops: []
      }),
      null
    );
    console.log('  ✓ No assigned shops still omits the metro block.');
  } finally {
    hooks.deregister();
    delete globals.__metroRouteTest;
    globalThis.fetch = originalFetch;
  }
});

// ── Runner ──────────────────────────────────────────────────────────────────
let failures = 0;
for (const { name, run } of suites) {
  const startedAt = Date.now();
  try {
    await run();
    console.log(`\n[metro] suite "${name}" passed (${Date.now() - startedAt} ms)`);
  } catch (error) {
    failures += 1;
    console.error(`\n[metro] suite "${name}" FAILED (${Date.now() - startedAt} ms):`, error);
  }
}

if (failures > 0) {
  console.error(`\n[metro] ${failures}/${suites.length} suites failed`);
  process.exit(1);
}
console.log(`\n[metro] all ${suites.length} offline suites passed`);
