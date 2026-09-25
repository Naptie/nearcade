# openmetro × nearcade — Integration Plan (v3, implementation status)

_2026-09-13 · openmetro v0.1.0-r3 · nearcade @ main. v1 server-engine → v2 hybrid → **v3 (this): server computes & ready-serves routes; browser persists nothing.**_ _Phase 0/1 revised 2026-09-15 for openmetro v0.1.0-r10 — see "r10 revision" notes inline and §1.1a. Implementation/status notes updated 2026-09-18._

**Purpose**: integrate openmetro (metro data for Beijing/Shanghai/Guangzhou) into `/discover` — metro travel-time shop discovery beyond the radius circle, always-on ambient metro-route overlay, AMap-free directions in the existing component, and metro-station rankings.

**Status**: Phases 3 (discover UI) and 4 (station rankings API/page/tabs) are implemented, alongside Phases 0–2. This is not a complete-validation or deployment-signoff claim. Historical live measurements below retain their original dates; live routing parity and full deployment signoff have **not** been reverified. The recorded full-check baseline of **23 auth-related errors plus one globe warning** is obsolete: as of 2026-09-19 `pnpm check` passes with **0 errors and 0 warnings** (fixed by `pnpm dedupe` unifying a duplicate `@better-auth/core` instance plus small type/signature fixes); see §7.

**All resolved decisions (do not re-litigate)**:

1. Union filter semantics (radius arm ∪ metro isochrone arm).
2. Always-on ambient hover overlay.
3. **Server runs Dijkstra and persists station metadata** — only the server can discover shops near reachable stations (the browser never knows shops beyond the radius; the metro arm is a server-side `$in` query over persisted assignments).
4. **Conservative walking speed** for all walk-time estimates (people walk to take metro).
5. **The browser persists no openmetro data.** The discover response is ready-to-serve: route display renders with zero client calls. The browser makes live openmetro API calls only for supplementary metadata (e.g. fares), cached in memory for the session.
6. Flat global station snapping across all networks (intercity lines just work).
7. Shop↔station assignments persisted in Mongo (single source of truth for discovery time estimates, ambient badges, and rankings).
8. openmetro-client packaging fixed in v0.1.0-r3 (verified).

---

## 1. Verified environment facts

### 1.1 openmetro (live API + release v0.1.0-r3, all verified)

| Network          | city.id (= nearcade region ID) | Lines | Stations |
| ---------------- | ------------------------------ | ----- | -------- |
| `cn-bj` 北京地铁 | `CN-11`                        | 28    | 426      |
| `cn-sh` 上海地铁 | `CN-31`                        | 20    | 416      |
| `cn-gz` 广州地铁 | `CN-4401`                      | 31    | 503      |

- All coordinates are **GCJ-02** (`coordinate_system: "gcj02"`) — identical to nearcade's stored shop coords. Never convert.
- **Payload sizes (measured)**: per network `stations` 95 KB, `graph?weight=time` 151 KB, `patterns` 19 KB, `lines` 4 KB → **~270 KB per network**, ~750 KB total. Trivial to persist in Mongo and hold in memory.
- **Fetched API shapes** (r10 corrections; abbreviated, not replacement schemas):
  - `GET /api/networks` → `{ networks: [{ id, name, city: { id: 'CN-11', name: {zh,en} }, coordinate_system, routing, … }] }`
  - `GET /api/networks/{id}` → network detail including `synced_at`.
  - `GET /api/networks/{id}/stations` → array of `{ id, name, names: {zh,en}, location: { lon, lat, crs: 'gcj02' }, status, lines: string[], is_interchange }`.
  - `GET /api/networks/{id}/lines` → array of `{ id, name, names: {zh,en}, mode, status, loop, color, short_name, … }` — official line colors and first-class short names, not the nonexistent r3 `extras.lcode/lnub` claim.
  - `GET /api/networks/{id}/graph?weight=time` → `{ nodes: [{ id, station_id, line_id }], edges: [{ from, to, kind, line_id, seconds, distance_km }], routing, … }` — wire fields are snake_case; persisted nearcade docs use camelCase.
  - `GET /api/networks/{id}/patterns` → array of `{ id, line_id, stop_ids: string[], terminal_stop_id, … }` — for "往 X" direction labels.
  - `GET /api/networks/{id}/route?from&to` → route metadata and discriminated ride/transfer legs (§1.1a); browser requests it only for fare enrichment, not route rendering. Also the live verify script's comparison source.
  - `GET /api/networks/{id}/travel-times?from&within` — isochrone; live verify-script comparison source.
- **Version detection**: r10 `synced_at` is primary; sha256 of the station payload is the fallback when that version is absent. Lack of `generated_at` does not mean the client lacks version metadata.

### 1.1a r10 revision (2026-09-15, verified against live v0.1.0-r10)

openmetro v0.1.0-r10 resolves the r3-era gaps that shaped Phase 0/1. The ideal implementation is now in place:

- **Runtime schemas ship in the client**: `openmetro-client/schemas` exports generated zod schemas (`apiNetworkListSchema`, `apiStationListSchema`, …) validated against the live API. nearcade's hand-written `openmetro*Schema` block (~120 lines) is **deleted**; the sync boundary re-validates payloads with the package's own schemas. (`openapi.json` `components.schemas` is fully populated — 45 named schemas — so third-party codegen works too.)
  - _Known wrinkle_: the generated `schemas.d.ts` declares zod-3 style generics, which do not **type**-check under nearcade's zod 4 (runtime is fully compatible). Compile-time types therefore come from the client's Eden-inferred entity exports (`ApiNetwork`, `ApiStation`, …) via thin `parseOpenMetro*` facades in `src/lib/openmetro/schemas.ts`; a zod-4-native d.ts upstream removes the facade.
- **`short_name` is first-class and mandatory on every line** (resolved upstream from operator data: BJ `slb`, GZ `lineShowCode`, SH name fallback). Verified live: `cn-bj-line-73 → "18"`, `亦庄T1线 → "亦庄T1"`, `大兴机场线 → "大兴机场"`, `S1线 → "S1"`, `cn-gz-line-apm → "APM"`, GZ `一号线 → "1"` (previously all-null), `浦江线 → "浦江线"`. nearcade's `deriveLineBadgeNumber` heuristic is **deleted**; the persisted field is renamed `lnub` → `shortName` (doc-shape v2).
- **`synced_at` on `GET /api/networks/{id}`** is the upstream data version (r10). The sync task now takes a **version fast-path**: detail route first; on `synced_at` match (+ current doc-shape version) the ~270 KB per-network reference fetches are skipped and the network is rehydrated from Mongo for the flat assignment/rankings phases (unforced re-sync: ~3.7 s, all networks). The sha256 station fingerprint remains recorded and serves as the fallback detector when `synced_at` is absent.
  - Eden deserializes the ISO wire string into a `Date` — normalized before persisting.
  - `schemaVersion` (currently 2) guards against stale-shaped docs surviving a deploy: a mismatch forces full re-persist even when data is unchanged.
- **Route legs are a discriminated union** (`kind: 'ride'` carries `station_ids`/`pattern_id`/`headsign_*`; `'transfer'` does not) — `verify-metro.ts` compares station sequences on ride legs only.
- Unchanged from r3 (re-verified live): the API still routes through out-of-service stations (all 426 cn-bj stations reachable), ride edges remain stored one-directional (0/515 reverse pairs; transfers symmetric), coordinates stay GCJ-02, and the network graph response gained a `routing` block (`default_transfer_seconds` 120, `max_transfer_seconds` 600) that nearcade's persisted edges already encode.
- Dependency pinned: `openmetro-client` = `github:Naptie/openmetro#48833c268f12041564a204739532cee9db5ea9b2` — the `client`-branch commit published by the v0.1.0-r10 release (byte-identical to the release tarball asset).
- CORS unrestricted, read-only, free. `route` cold ~1 s → never call per-shop in hot paths.

### 1.2 nearcade (verified in code)

- **Discover API**: `src/lib/endpoints/discover.server.ts` (`loadShops`; used by page server load and `src/routes/api/discover/+server.ts`). Params (`src/lib/schemas/discover.ts`): `latitude/longitude` (aliases `lat/lng`), `radius` km clamp 0–30 (0 = unlimited), `limit` ≤ 150 (`MAX_DISCOVER_RESULTS`), `gameTitleIds` (`$all`), `name`, `fetchAttendance`, `includeTimeInfo`, `convertFrom`. Query = Mongo `$near` on `location_2dsphere`; results sorted by **travel time** (distance breaks ties); regions expanded server-side.
- **Discover page**: `src/routes/(main)/discover/+page.svelte` (~1790 lines). Dual engine: AMap JS API 2.0 for China shops / Google Maps when all shops overseas (`useGoogleMaps` via `isShopChinaBased`). `travelData[shopId] = { time, distance, path, route: Polyline, routeData }` (`~86`) drives travel-time re-sorting (`~185`), avg-color thresholds, table column, route polylines. AMap travel data computed client-side & sequentially in `calculateTravelData` (`~286–457`) via `AMap.Transfer/Walking/Riding/Driving` through the `/_AMapService` proxy (QPS retry + 24 h IndexedDB `route-cache`). Transport-method effect `~818`; hover restyle `~841`; selected-shop `~866`; traffic layer `~990`; `<Directions>` usage `~1056`; method dropdowns `~1152`/`~1256`; settings updates `updateDiscoverSettings` `~1030`.
- **Directions component**: `src/lib/components/Directions.svelte` detects transit via `'nightLine' in route`; renders segments from data (`on_station`/`off_station`/`via_stops`/`entrance`/`exit`/`lines[0].name`). Time and distance remain separate stats; fare is an optional third stat, with loading state and a two-column layout when absent. Explicit zero fares are valid; synthetic `cost: 0` is not a reported fare. Official line colors override the fallback segment palette. AMap shapes are in `src/lib/types/amap.ts`.
- **Rankings pattern**: admin tasks materialize Mongo collections with rank keys + an `_id: 'metadata'` doc. Metro uses `rankOrder[sortBy]`, deterministic global ranks, and its own cursor-paginated API (`src/routes/api/rankings/metro/+server.ts`). The `/rankings/metro` page shares campus/region/metro navigation tabs and uses `RANKING_FIXED_GAMES` columns (§3.6).
- **Infra**: MongoDB 7 (Zod schemas only; in-memory wholesale caches have precedent — `initRegionCache` in `src/lib/regions/utils.server.ts`), Redis (`nearcade:*`), Cloudflare Workers (`nodejs_compat`), paraglide i18n (`messages/{en,zh,ja}.json`, `pnpm mw`), OpenAPI per-route `openapi.ts` (`pnpm openapi`). `elysia` + `@elysia/eden` already dependencies.

---

## 2. Architecture (v3)

```
                    ┌─ PERSISTED (Mongo) ────────────────────────────────────┐
   openmetro API ──►│ metro_stations · metro_lines · metro_patterns ·        │  written ONLY by
   (server task,    │ metro_edges · openmetro_networks (hash/version meta)   │  openmetro_sync
   free, one-shot)  │ shops[].transit.metro = { stationId, stationName,        │  (fetch → hash →
                    │   walkSeconds, distanceKm, lines[{id,name,color,shortName}] } │  persist → reassign
                    └────────────────────────────────────────────────────────┘
                                        │  lazy in-memory cache (per isolate,
                                        │  version-checked) ≈ region-cache pattern
                                        ▼
   GET /api/discover ──► snap origin (flat, all networks) → Dijkstra (one run, <5 ms)
                         → isochrone arm: shops via { 'transit.metro.stationId': { $in: reachable } }
                         → estimate per shop (metro only, when it beats walking) → UNION with radius arm ($near)
                         → admit radius hits OR worthwhile metro trips within budget → sort by time → cut to limit
                         → response carries READY-TO-SERVE route display
                                        │
   BROWSER ◄───────────────────────────┘
     • renders badges, hover overlay, Directions purely from the response — ZERO openmetro calls
     • live openmetro calls ONLY for supplementary metadata (fares via /route) when the
       Directions panel opens; in-memory session cache; nothing persisted
```

**Why the server must compute the isochrone**: shop candidacy beyond the radius is a database question (`'transit.metro.stationId' ∈ reachable-stations`), and only the server holds the shop collection. The browser can neither enumerate nor filter shops it never received. Hence: persisted station metadata + server Dijkstra + the `transit.metro.stationId` partial index = O(reachable stations) indexed retrieval of nearby shops, shared verbatim by the isochrone arm and the station rankings.

**Ready-to-serve response**: one Dijkstra from the origin station yields dist + predecessor maps for _all_ stops; every returned metro shop's itinerary (legs with station sequences) is reconstructed locally and embedded in the response together with the referenced stations' coords/names and lines' colors/names. The browser renders hover polylines and the Directions panel from this alone. Fares (and future extras like timetables) are fetched live by the browser per Directions-open via the typed client — the only openmetro traffic at runtime.

---

## 3. Component specs

### 3.1 Server persistence — `src/lib/openmetro/` + `src/lib/admin/data-updates.server.ts`

**Mongo collections** (written only by the sync task; all tiny):

- `metro_stations` `{ _id: stationId, networkId, name, names: {zh,en}, lon, lat, status, lineIds, isInterchange }` (~1.3 k docs)
- `metro_lines` `{ _id: lineId, networkId, name, names, color, mode, loop, shortName }` (~80 docs)
- `metro_patterns` `{ _id: patternId, networkId, lineId, stopIds, terminalStationId }` (~85 docs)
- `metro_edges` `{ from, to, kind: 'ride'|'transfer', networkId, lineId?, seconds, distanceKm }` (~1.6 k docs; from/to are stop ids — carry `stationId` too, denormalized, to save a join)
- `openmetro_networks` `{ _id: networkId, name, cityRegionId, stationsHash, stationCount, lastSyncedAt }`

**Task `openmetro_sync`** (registered beside `campus_rankings`; admin UI at `/admin/data-updates` / SSC trigger; recommend daily cron):

1. _Fetch & version_: fetch networks and each network's detail first. Matching `synced_at` plus current schema version skips reference fetches and rehydrates that network from Mongo. Otherwise fetch stations/lines/graph/patterns, retaining the station hash as the fallback detector when `synced_at` is absent.
2. _Persist_: write the five reference collections only for changed or forced networks (a schema-version mismatch counts as changed). **Unchanged data skips only reference writes, not the rest of the sync.**
3. _Assign on every sync_: concatenate all networks' operating stations **flat**; for every shop, snap to the globally nearest station (haversine, GCJ-02 both sides); if ≤ `METRO_ACCESS_MAX_KM` → `$set shop.transit.metro`, else `$unset` (also clear stale assignments when coordinates are lost). `shop.transit.metro = { networkId, stationId, stationName, distanceKm, walkSeconds, lines: [{id, name, color, shortName}] }` (lines denormalized so badges render with zero joins). The `transit` wrapper keeps the door open for other transport metadata (bus, parking) without another top-level field.
4. _Rankings on every sync_: rebuild `metro_station_rankings` (§3.6) with per-radius metrics over all shops, deterministic ranks and metadata from current data, even if every upstream network is unchanged. Shop additions/deletions, moves and game edits are independent of upstream versions. Equal metrics break ties by locale-independent `_id` ascending order; ranks are unique and deterministic across input read orders.

Optional opportunistic inline assignment on shop create/update remains a future option; the task is authoritative. If walk constants change, re-run the task (walkSeconds are persisted).

**Mongo indexes** (`initDatabase`): `shops { 'transit.metro.stationId': 1 }` partial — serves the isochrone arm, rankings aggregation, and station-centric lookups.

### 3.2 Server routing core — `src/lib/openmetro/{snapshot,graph,route}.server.ts`

- **`snapshot.server.ts`**: module-level in-memory cache (mirror `initRegionCache`): `{ version, stations (flat, all networks), linesById, patterns, adjacency (stop-level), stationsById }`, built lazily from Mongo on first metro request; version = max `lastSyncedAt`; re-check version at most once per 60 s. Rebuild ≈ reading ~750 KB from Mongo — cold-start cost only for isolates that actually serve metro requests.
- **`graph.server.ts`**: `snapToStation(lat, lng)` over the flat station array; `dijkstra(originStationId)`: initialize **all stops of the origin station at 0** (enter the system once; no self-transfer penalty), standard Dijkstra over stop-level adjacency (ride + transfer edges, weight = seconds), → `{ distByStop, bestStopByStation (min over a station's stops), prev }`. ≤ 600 nodes — sub-ms; no budget cut (one run serves filtering _and_ every itinerary).
- **`route.server.ts`**: walk `prev` from a shop's best stop back to origin → merge consecutive same-line ride edges into `ride` legs (`stationIds: string[]`, `seconds`, `distanceKm`, `direction` = terminal station name via patterns) and transfer edges into `transfer` legs. Produces the response's `metro` block (§3.4); access/egress walks are included in totals and rendered by the client from origin/station/shop data, not separate server response legs.
- **`client.server.ts`**: typed-client wrapper used by the sync task. `.env.example` has `PUBLIC_OPENMETRO_API_BASE = ""`; blank/unset uses `https://openmetro.phi.zone`. No API key is required.

### 3.3 Shared constants — `src/lib/constants.ts`

```ts
export const METRO_WALK_SPEED_KMH = 4.5; // preferred walking speed 1.10–1.65 m/s; design guides use 4.8–5.0
export const METRO_RIDE_SPEED_KMH = 15.0; // utility cycling (shared bikes/scooters) in city traffic
export const METRO_WALK_DETOUR_FACTOR = 1.3;
export const METRO_ACCESS_MAX_KM = 2.0; // shop↔station assignment cutoff
export const METRO_ORIGIN_MAX_KM = 3.0; // origin→station cutoff, else metro unavailable
export const METRO_ENTRY_OVERHEAD_SECONDS = 240; // security + platform wait
export const METRO_EXIT_OVERHEAD_SECONDS = 120;
export const METRO_MIN_RIDE_STATIONS = 2; // a one-station "trip" is not a trip

// The search radius *is* the travel-time input: each distance option carries a
// door-to-door budget, so the UI labels "5 km · 45min" and the server filters
// by that budget without a second control. `minutes` must strictly increase
// with `km`.
export const DISCOVER_RADIUS_BUDGETS = [
  { km: 1, minutes: 20 },
  { km: 2, minutes: 35 },
  { km: 5, minutes: 45 },
  { km: 10, minutes: 60 },
  { km: 20, minutes: 90 },
  { km: 30, minutes: 120 }
] as const;
```

**Total travel time** (computed server-side; same formula everywhere):
`totalSeconds = accessWalkSeconds + ENTRY + isoSeconds[shopStation] + EXIT + shop.transit.metro.walkSeconds`
Walk seconds everywhere = straight-line km × 1.3 ÷ **4.5** km/h. (SH/GZ transfer times come from the network's 120 s default; entry/exit overheads already add conservatism — no extra transfer padding.)

**Straight-line times are inferences, not routed results.** Walking/cycling reference speeds justify radius budgets; `computeWalkSeconds(distance)` supplies the metro comparison baseline (including the 1.3 detour factor). The UI also uses it through `inferTravelSeconds()` as a per-row fallback, explicitly marked `~` with a distance-based-estimate tooltip. This is not a measured street route or a promise of arrival time.

**Metro eligibility is a race, not a distance band.** A shop gets a server `travel` estimate only when **both** hold:

1. **The full door-to-door metro total beats the walking baseline** (`itinerary.seconds < computeWalkSeconds(distance)`). Compare the total including access, entry, in-system travel, exit and egress, not `travel.metroSeconds` (in-system seconds only).
2. **The ride uses ≥ 2 distinct stations** (`METRO_MIN_RIDE_STATIONS`). Entering and leaving at one station is a walk plus fare gates, not a metro trip.

There is no distance band: eligibility depends on the shop's own distance and itinerary, not the selected radius. With fixed inputs, wider radii/budgets preserve **candidate admission** before retrieval caps and final truncation; this does not guarantee extra candidates, nor a superset of returned fixed-top-N results. Newly admitted faster trips may displace earlier rows.

**A shop without a worthwhile metro trip has no server `travel` or metro itinerary**, but the UI still shows a time: a live AMap result if available, otherwise the marked inference. Inference alone does not create directions.

### 3.4 Discover API — `src/lib/endpoints/discover.server.ts` + `src/lib/schemas/discover.ts`

**No separate travel-time param or metro transport method.** The radius _is_ the travel-time input: `getTravelBudget(radius)` yields the door-to-door budget for metro admission **beyond** the radius. In-radius shops remain admitted by distance; they need not fit the time budget.

**Pipeline**:

1. **Budget**: `budget = getTravelBudget(radius)`; `budgetSeconds = budget.minutes × 60` (null when `radius=0` = unlimited).
2. **Radius arm**: `$near` with `$maxDistance = radius × 1000`, over-fetched to `min(limit × 3, 450)`.
3. **Snap origin** (flat, all networks; ≤ `METRO_ORIGIN_MAX_KM` else skip to 5).
4. **Dijkstra** from origin station (§3.2).
5. **Metro arm**: pre-filter stations by `isoSeconds + ENTRY + EXIT ≤ budgetSeconds`, then `shops.find({ 'transit.metro.stationId': { $in: reachableStationIds } })` — indexed `$in` retrieval of shops near reachable stations (this is how shops beyond the radius are discovered).
6. **Union** (dedupe by id) of radius hits and metro-reachable shops.
7. **Estimate** each shop's `travel` via `estimateTravel` — present only when the metro beats the straight-line walk between ≥ 2 stations (§3.3); otherwise the shop carries no `travel` at all.
8. **Admission**: a shop inside the radius is admitted by distance, exactly as before metro existed. Beyond the radius the only justification is a metro trip that fits `budgetSeconds` — which is how the metro surfaces new shops.
9. **Sort** by travel time (shops without one fall back to their straight-line walking inference, monotonic in distance), then distance, then id; **cut to `limit`** so the final union count is always respected.
10. **Ready-to-serve metro block**: embed prebuilt itineraries only for returned shops with a worthwhile trip. Station-path templates may be cached/shared, but each shop gets its own itinerary total including **that shop's egress walk**, equal to `shop.travel.seconds`; never mutate the cached zero-egress station template. `metro.origin.lon/lat` are the actual search-origin coordinates (GCJ-02 after any requested conversion), while the snapped station coordinates live in `metro.stations[metro.origin.stationId]`. This preserves the actual origin→station access path.

```ts
// top-level (omitted when origin un-snap-able or no worthwhile returned itineraries)
metro?: {
  network: { id, name, cityRegionId },
  origin: { stationId, stationName, walkSeconds, lon, lat }, // actual search-origin lon/lat
  lines:    { [lineId]: { id, name, color, shortName } },  // referenced only
  stations: { [stationId]: { name, lon, lat } },          // station coords, including origin station
  shops: { [shopId]: {
    totalSeconds, rideSeconds, transferCount, // total includes this shop's egress walk
    legs: [{ kind: 'ride'|'transfer', lineId?, stationIds: string[], seconds, direction? }]
  } }
}
// per shop (persisted assignment, always present when assigned — powers badges even without the block)
transit?: { metro?: { networkId, stationId, stationName, walkSeconds, distanceKm, lines: [{id, name, color, shortName}] } }
// per shop (computed estimate — present ONLY when the metro beats walking there)
travel?: { seconds, metroSeconds }
```

The original metro-block size estimate was ≈ 50–80 KB for 150 shops; the historical Phase 2 **full response** measurement was ≈272 KB raw / ≈90 KB gzip at `limit=150`, recorded in OpenAPI. Neither is a fresh payload measurement (optional opt-out remains a future idea).

### 3.5 Discover UI — `src/routes/(main)/discover/+page.svelte` + `Directions.svelte` (implemented)

**No runtime openmetro routing calls for discovery or route rendering, no IndexedDB openmetro store.** Geometry and directions render from `data.metro` / `shop.transit.metro`; optional fare enrichment is the only live openmetro exception below.

**The travel column shows a time for every row.** Three sources, in order of authority:

1. **a live AMap result** — a real routed path, so it wins outright;
2. **the server's metro estimate** — a real itinerary;
3. **a straight-line inference** (`inferTravelSeconds`) — rough, but it means the column is never mostly blank. The UI marks these with a leading `~` and a "distance-based estimate" tooltip.

**A toggle switches time-first / distance-first** (`DISCOVER_TIME_PRIMARY_KEY` in localStorage, time by default). The same preference drives both which value leads the column _and_ the sort order — a straight-line distance says little about how long a trip takes, so time is the honest default even when it is inferred.

**AMap always outranks the metro itinerary.** When a transport method yields a route, that result:

- feeds the travel column (overwriting the server estimate in the same place),
- opens the Directions panel in preference to the metro plan,
- suppresses the ambient metro overlay for that shop (a live route draws itself),
- skips the openmetro fare lookup entirely (AMap reports its own cost).

Nothing transport-related is rendered next to the shop id any more; the column is the single place time and distance appear.

**Controls**: the radius select doubles as the travel-time control — each option is labelled `"5 km · 45min"` via `getTravelBudgetMinutes`. There is **no separate travel-time select and no separate metro transport method**: the default **Not Specified** opens the shop's itinerary on click (the server already supplies it), and the remaining methods (`transit`/`walking`/`riding`/`driving`) drive the AMap travel column.

**Always-on ambient layer** (independent of transport method):

- **Badges**: line marker chips and table badges show the line's `shortName` in its official color (e.g. `1 天安门东`) — from `shop.transit.metro`, including when no response metro block exists. Badge text uses adaptive light/dark contrast (`getMetroBadgeTextColor`) for readable line colors. No time is shown beside the badge (the travel column carries that).
- **Hover** (marker or table row): build polylines purely from the response — `ride` legs solid in official line colors (stations map → coords), `transfer`/walk legs dashed gray (actual search origin↔origin station, egress station↔shop) — at the existing `ROUTE_INDEX`/`HOVERED_ROUTE_INDEX` z-bands; remove on mouseout, persist while selected. Follow interleaved ride/transfer order; zero-length transfers remain in Directions but need no overlay geometry. Shops without a metro trip paint nothing.
- **Click**: the live AMap route wins when one exists; otherwise `buildMetroTransitPlan(shop, data.metro)` (via `buildMetroRouteData`) feeds the existing Directions component with metro/fare props. Shops with neither have no directions; their inferred column time does not create a route. Mapping:

| response data                                    | synthetic AMap shape                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| metro block + shop                               | `TransitPlan { cost: 0 (synthetic; the live fare arrives as a separate prop), time: totalSeconds, nightLine: false, distance, transit_distance, walking_distance, railway_distance: 0, taxi_distance: 0, path: all leg coords }`                                                                                                                                             |
| access walk                                      | `Segment { transit_mode: 'WALK', instruction: m.walk_to_station({station}), transit: { path: [origin, originStationCoord] } }`                                                                                                                                                                                                                                               |
| `ride` leg (line L, stations S₀…Sₙ, direction T) | `Segment { transit_mode: 'SUBWAY', transit: { lines: [{ id, name: \`${L.name}(${S₀.name}--${T})\`, type: 'SUBWAY', stime: '', etime: '', color: L.color }], on_station: {name, id, location}, off_station: {name: Sₙ,…}, via_num: n−1, via_stops: S₁…Sₙ₋₁, path: station coords } }`—`name(A--B)`flows through the existing`formatTransitLineName` ⇒ “1号线 (王府井 → 四惠)” |
| `transfer` leg at X                              | `Segment { transit_mode: 'WALK', instruction: m.transfer_at({station: X.name}), transit: { path: [X, X] } }`                                                                                                                                                                                                                                                                 |
| egress walk                                      | `Segment { transit_mode: 'WALK', instruction: m.walk_to_shop(), transit: { path: [egressStationCoord, shopCoord] } }`                                                                                                                                                                                                                                                        |

Entrance/exit omitted (no data → sections don't render). External deep link (`getRouteLink` → `uri.amap.com/navigation`) unchanged.

**Live fare enrichment** (openmetro traffic beyond the discover call): when the panel opens on a shop whose **metro itinerary** is displayed, `src/lib/utils/metro.client.ts` calls `/api/networks/{id}/route?from=<originStation>&to=<shopStation>` via the typed client (free) and takes `fare`/`currency`. The fare is passed to `<Directions>` as its own prop and rendered as a **separate third stat**, never overwriting the travel time — while pending the stat shows a skeleton, and if openmetro publishes no fare the column is dropped. In-memory `Map` session cache keyed `from:to`; nothing persisted.

**Fare presence is explicit, not truthiness-based.** A finite, nonnegative reported fare is valid, including **zero** (from openmetro or AMap). Synthetic `cost: 0` alone is not a fare. Missing/failed fares clear the loading state and remove the entire third column (`grid-cols-2` instead of an empty slot); pending/present fares use three columns. AMap routes use their own reported cost and skip openmetro enrichment.

**Directions changes**: metro/fare/loading props, separate time/distance/fare stats with adaptive column count, and official segment line colors overriding the fallback palette. This is more than a five-line color-only change; the existing AMap route rendering remains supported.

**Engine gating**: metro features require the AMap engine — guaranteed since `useGoogleMaps` only triggers when all shops are overseas and only CN shops carry `metro`; belt-and-braces gate on `!useGoogleMaps`.

### 3.6 Station rankings (implemented; **revised 2026-09-18 to the campus-parity model**)

Metro stations are POI-based discovery, identical in shape to campus rankings. The page therefore reuses the shared `RankingsHeader`/`RankingsTable` components (network tabs in place of the region tabs, radius column headers `< 200m/500m/1km/2km`), and the sync task stores **per-radius metrics** instead of a single assignment-snapshot metric. The radius options are metro-specific (`METRO_RANKING_RADIUS_OPTIONS = [0.2, 0.5, 1, 2]` km): the **largest** radius equals the shop↔station snapping cutoff (`METRO_ACCESS_MAX_KM` = 2 km), so the widest bucket's shop/machine counts are exactly the persisted `transit.metro` assignments — no extra shop enumeration is needed for the ranking. Every bucket is a straight-line cache computed from the same shop projection.

Task phase 4 (§3.1) computes, for every station with ≥ 1 assigned shop, metrics over **all** shops by straight-line distance → `metro_station_rankings`:

```ts
{
  id: 'cn-bj:cn-bj-wangfujing',             // same as _id; satisfies RankingsTableItem
  _id: 'cn-bj:cn-bj-wangfujing',
  networkId, stationId, name, names: { zh, en },
  lines: [{ id, name, color, shortName }],   // denormalized — page needs zero openmetro calls
  location: { lon, lat },                   // powers "从这里探索"
  rankings: METRO_RANKING_RADIUS_OPTIONS.map((radius) =>
    ({ radius, shopCount, totalMachines, areaDensity, machinesPerCapita: null,
       gameSpecificMachines: [{ name: gameKey, quantity }] })),
  rankOrder: { shops_20, shops_50, shops_100, machines_200, … }  // metroRankingSortKey(sortBy, radius)
}
// Rank keys encode the radius in centimetres (`0.2` km → `20`, `2` km → `200`):
// Mongo query paths split on '.', so decimal radii must never appear literally
// in `rankOrder` field names — `rankOrder.shops_0.2` would silently query the
// nested path shops_0 → 2 and break sorting/cursor pagination.
}
// _id: 'metadata' → { createdAt, expiresAt, totalCount, isCalculating, networks: [{id, name, stationCount}] }
```

Stations with zero assigned shops are excluded (they can never surface a badge, so ranking them would show empty rows). Every sync refreshes assignments, metrics, deterministic ranks and metadata, even with unchanged upstream data. Metric ties sort by `_id` ascending, assigning unique global `rankOrder[metroRankingSortKey(sortBy, radius)]` values. Area density is always defined (circles, not polygons); per-capita stays null.

**API** `GET /api/rankings/metro?networkId=&sortBy=shops|machines|<gameKey>&radius=0.2|0.5|1|2&limit=&after=` has shared runtime query/response schemas and `openapi.ts`:

- `radius` (km, decimals allowed) defaults to **2** (the snapping cutoff, the widest bucket); values outside `METRO_RANKING_RADIUS_OPTIONS` return 400.
- `limit` is a positive integer, **maximum 100**; invalid values return 400.
- `after` is a numeric rank cursor encoded as a positive safe-integer decimal string, without leading zeros. It is not a station ID. Reset it when switching network, sort key or radius.
- Pagination compares global `rankOrder[metroRankingSortKey(sortBy, radius)] > after`, fetches `limit + 1`, and returns at most `limit`. Filtered ranks may have gaps and are not renumbered. `nextCursor` is the last returned global rank only when `hasMore`, otherwise null.
- `totalCount` counts all matching stations for the network filter, **independent of the cursor**. `networks: [{ id, name, stationCount }]` is the full metadata list, unaffected by filtering; `stationCount` counts ranked stations (with shops), not all reference stations.
- Responses expose `cached`, `cacheTime`, `stale`, and `calculating`. No metadata yields an empty, stale/calculating response. Sync preserves network identities during calculating/failure states.

**Page** `/rankings/metro`: shared `RankingsHeader` (sort select via `METRO_SORT_CRITERIA` = `SORT_CRITERIA` minus density/per-capita) + `RankingsTable` with radius column headers; network tabs from response metadata; official line-color badges in the name column; scroll-based incremental loading (campus pattern). Row action 从这里探索 → `/discover?latitude=&longitude=&name=<station>&radius=<radiusFilter>`. The shared rankings layout provides **campus / region / metro tabs**. Rankings read persisted data only: **no runtime openmetro routing calls**, including for badges and station coordinates.

**Landing-page preview**: `/api/home/stats` adds a `metro` block (per-radius top-10 by shops/machines from `metro_station_rankings`, localized station names via `names` + coordinates for discover deep links). The home page's mini leaderboards render **metro (left) + campus (right)** in the first row; region moves to a second full-width row split into two boards (shops / machines), effectively 2× wider. Metro group labels use `formatDistance` so 0.2/0.5 km render as 200 m/500 m.

---

## 4. File-level implementation inventory

**Added by the integration**

- `src/lib/openmetro/schemas.ts` — r10 client-inferred fetched entity types and `parseOpenMetro*` facades over real package runtime schemas; local persisted-document schemas (not hand-written replacement upstream schemas)
- `src/lib/openmetro/client.server.ts` — typed-client wrapper for the sync task
- `src/lib/openmetro/snapshot.server.ts` — Mongo-backed versioned in-memory cache
- `src/lib/openmetro/sync.server.ts` — reference persistence, every-sync assignments/rankings and deterministic ties
- `src/lib/openmetro/graph.server.ts` — flat snapping + Dijkstra (dist/prev/best-stop)
- `src/lib/openmetro/route.server.ts` — legs reconstruction + response `metro` assembly
- `src/lib/utils/metro.client.ts` — browser-only: `buildMetroTransitPlan`, hover polylines, adaptive badge contrast, live fare enrichment (typed client, in-memory cache)
- `src/lib/utils/travel.ts` — shared trip totals, metro eligibility and marked UI time inference
- `src/lib/schemas/metro.ts` — embedded assignment, discover metro block and ranking schemas
- `src/lib/schemas/rankings.ts` — zod `RankingMetrics` shared by metro ranking responses
- `src/routes/api/rankings/metro/{+server.ts, openapi.ts}`
- `src/routes/(main)/rankings/metro/{+page.ts, +page.svelte}` — reuses the shared `RankingsHeader`/`RankingsTable` components
- `src/routes/(main)/rankings/+layout.svelte` — campus/region/metro tabs
- `scripts/verify-metro.ts` — live server/upstream routing parity checks (not rerun in this update)
- `scripts/validate-metro.ts` — bounded offline regressions, three suites (sync / rankings / route) run by `pnpm test:metro` (§7)

**Modified by the integration**

- `src/lib/schemas/discover.ts` — `travel` estimate field; `metro` response block
- `src/lib/endpoints/discover.server.ts` — snap/Dijkstra/metro-arm/union/embed (additive)
- `src/lib/types/index.ts` — shop transit/travel typing; **no `'metro'` member added to `TransportMethod`**
- `src/lib/constants.ts` — §3.3 constants and `METRO_SORT_CRITERIA`
- `src/routes/(main)/discover/+page.svelte` — radius-as-budget labels, marker/table chips, inferred-time fallback, ambient overlay, synthetic directions and fare state
- `src/lib/components/Directions.svelte` — official line colors, metro/fare props and optional third-stat layout (zero fare supported)
- `src/lib/admin/data-updates.server.ts` — `openmetro_sync` task (4 phases)
- `src/lib/utils/index.server.ts` — `{ 'transit.metro.stationId': 1 }` partial index
- `messages/{en,zh,ja}.json`, `.env.example` (`PUBLIC_OPENMETRO_API_BASE`), `README*`
- `package.json` — `openmetro-client` (pinned: r10-published client commit, §1.1a), `zod` (peer via ./schemas subpath)

---

## 5. Phases & effort

| Phase | Scope                                                                                                                                                                                                                                                                         | Est.    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0     | Deps (`openmetro-client` r3 + `effect`), env, scaffold — **done 2026-09-13; revised to the r10 ideal 2026-09-15 (§1.1a)**                                                                                                                                                     | 0.25 d  |
| 1     | Server core: sync task (fetch→hash→persist→assign→rankings scaffold), in-memory cache, Dijkstra, legs/assembly + `verify-metro.ts` green — **done 2026-09-13; revised to the r10 ideal 2026-09-15**                                                                           | 2–2.5 d |
| 2     | Discover API: radius-as-budget, metro arm `$in` retrieval, union, ready-to-serve block, OpenAPI — **done 2026-09-15** (scenario matrix green: legacy/pure-isochrone/union/cross-network/far-origin; response ≈272 KB raw / ≈90 KB gzip at `limit=150`, documented in OpenAPI) | 1 d     |
| 3     | UI: radius-as-budget labels, line marker/table chips with adaptive contrast, ambient overlay, synthetic Directions, time inference/toggle, optional live fare, i18n — **implemented; status reviewed 2026-09-18**                                                             | 1.5–2 d |
| 4     | Rankings: every-sync task refresh, deterministic ranks, validated paginated API, network metadata, page + shared tabs — **implemented; status reviewed 2026-09-18**                                                                                                           | 1–1.5 d |

Original effort estimate: ≈ 6–8 d. Phases 1–2 separate the API/data work from the UI. Implemented status is not deployment approval; earlier green/live results above are historical, not a fresh full validation.

## 6. Edge cases & degradation (must-handle)

- **No station near origin** (> 3 km): no `metro` block; badges still render (persisted); radius arm unaffected; UI time falls back to AMap/inference.
- **Union admission**: radius hits remain admitted by distance; outside-radius shops need a worthwhile metro trip within budget. If origin cannot snap, the metro arm is empty (not an error).
- **Final cap**: the radius arm is over-fetched to `min(limit × 3, 450)`; after union, admission and sorting, the response is cut to `limit`. `radius=0` removes the distance/time cap, **not** the result limit. Candidate-admission monotonicity is not a fixed-top-N superset guarantee.
- **Stale metadata after a network update**: sync task bump rebuilds the in-memory cache within 60 s; assignments for removed stations are unset by phase 3; itinerary builder skips unknown ids defensively.
- **Out-of-service stations** (3 in cn-bj in historical checks): **persisted and routed through** (the live API reached them in r3/r10 checks); excluded from snapping only (assignment candidates + origin entry). Every station doc carries `status` for consumers.
- **openmetro API unreachable**: affects the sync task and live fare lookups; fare failures are silent and remove the fare column. Discovery/rankings keep serving persisted data.
- **Unreachable shop station** (including disconnected networks): no metro estimate/itinerary; persisted station badges remain and the UI uses AMap or marked inferred time. Flat snapping does not create missing graph connections.
- **Coordinate systems**: assert `coordinate_system === 'gcj02'` per network at fetch; skip unknown CRS networks. The response origin is the actual GCJ-02 search point, not a station coordinate.
- **Constants changes** (`METRO_WALK_SPEED_KMH` etc.): persisted `walkSeconds` depend on them — re-run `openmetro_sync`.
- **Unchanged upstream**: still refresh shop assignments and station rankings; only reference fetches/writes may be skipped (§3.1).

## 7. Testing & verification

### Offline regressions (passed 2026-09-19)

Run from the repository root with dependencies installed and a Node version supporting the route suite's `node:module.registerHooks` API:

- `pnpm test:metro` — one entry point, three mocked suites:
  - **sync** — mocked upstream and in-memory Mongo; unchanged-version/hash paths still refresh shop/game changes and deletions, deterministic ties across read orders, forced/schema-version persistence, and calculating/failure network metadata.
  - **rankings** — query defaults/boundaries and invalid input, in-memory OpenAPI generation, actual handler with mocked Mongo: filtered/global numeric cursors, cursor-independent totals, full network metadata, cache states and errors.
  - **route** — real routing/assembly/discover/client geometry with external boundaries stubbed: per-shop egress totals without mutating a shared station template, actual search-origin access geometry, zero access at the station, and omitted block with no assigned shops.

These checks use no live openmetro routing or production database. They are bounded regressions, not complete integration/UI validation.

### Remaining limitations / signoff

- The previous full `pnpm check` baseline of **23 auth-related errors and one globe warning** is resolved: as of 2026-09-19 `pnpm check` passes with **0 errors and 0 warnings** (root cause was a duplicate `@better-auth/core` instance from non-deduped peer resolution, fixed by `pnpm dedupe`, plus `string | undefined` tolerance in `getCallbackURI`/`resolveRedirectURI` and a `$state` declaration fix on the globe page).
- **Live parity and full deployment signoff have NOT been reverified.** `scripts/verify-metro.ts` remains the separate live Dijkstra vs `/travel-times` and `/route` parity check; historical Phase 1/2 results do not certify the current deployment.
- Remaining manual QA: city center/suburb/far origin; all radius options and unlimited radius; candidate-admission monotonicity separately from fixed-top-N truncation; AMap→metro→marked inference precedence; final result limit; line chips/contrast, hover/click, dark mode/mobile/Google engine; fare pending/missing/failure/**zero** with correct column count.
- Rankings deployment QA: compare station metrics to a real Mongo query, verify tab/network/sort changes and cursor resets, pagination, and cold/stale/calculating states. Offline mocks do not replace these checks.

## 8. i18n keys (`messages/{en,zh,ja}.json`, run `pnpm mw`)

`transport_metro` (地铁/Metro), `metro_travel_time` (地铁时间范围), `within_travel_time_minutes`, `metro_station` (地铁站), `metro_unavailable_nearby` (附近没有地铁站，仅按距离筛选), `metro_time_estimate_note` (时间为保守估算值…), `walk_to_station` (步行前往{station}站), `transfer_at` (在{station}站换乘), `walk_to_shop` (步行前往店铺), `stations_ranking` (地铁站排行), `from_this_station` (从这站出发探索), `fare` (票价).

## 9. Out of scope (future ideas)

Fare-matrix persistence (browser live-fetch covers v1), last-train warnings (timetables), line-level rankings, nearcade station detail pages (the `transit.metro.stationId` index already supports them), share-codes (`?d=`) carrying the radius, isochrone visualization on the globe, openmetro exposing `generated_at` in API responses (would replace the content-hash versioning).
