# KITSUNE render module contract

This is the contract between `render/renderer.js` (the orchestrator) and the
modules it composes. Every module is an ES module importing `three` and, for
addons, `three/addons/...` (importmap in `prototype/index.html`). No bundler,
no TypeScript, no other dependencies. Everything must run from a static file
server with WebGL2.

## Coordinates

* **Design space = sim space.** `x` across the road (positive = the runner's
  right), `y` up, `z` forward (increasing as the runners advance). The renderer
  applies the one mirror needed for three.js's right-handed camera by putting
  the whole world under a `stage` group with `scale.x = -1`; modules never
  mirror anything themselves. **Text and other asymmetric textures must
  therefore be drawn pre-mirrored** (flip the canvas horizontally with
  `ctx.translate(w, 0); ctx.scale(-1, 1)` before drawing text) so they read
  correctly on screen.
* Sim constants come from `../core/chunks.js`:
  `LANES=3, TRACKS=2, LANE_W=2.2, TRACK_GAP=2.6, TRACK_W=6.6, ROAD_HALF=7.9,
  CHUNK_LEN=36, BEAT_LEN=6, BIOMES=['mountain','city','suburb','coast'],
  SEASONS=['spring','summer','fall','winter'], biomeOf(i), seasonOf(i),
  seasonBlend(i), laneX(lane), trackX(track), cellX(cell)`.
  Track 0 (the tanuki) is centred at x=-4.6, track 1 (the kitsune) at x=+4.6.
  The paved road spans |x| ≤ 7.9 with a 2.6 m median at the centre. Keep
  scenery outside |x| ≥ 8.6 unless it is deliberately on the median.
* A chunk covers z ∈ [z0, z0+36). Root space scrolls so the runners are at z=0
  in scene space; distant scenery (sky, mountains) lives in scene space and is
  static.
* Time of day: `night` ∈ [0,1] (0 = golden hour, 1 = deep night) is a global
  driven by distance; every module accepts it in `update`.
* Season and biome are integers (index into the arrays above). A chunk's
  `chunk.biome` / `chunk.season` are set by the sim. Seasons change every 14
  chunks; a blend value `seasonBlend(i)` ∈ [0,1) says how far through the
  season section chunk i is, for fading colours near the boundary.

## Shared helpers — `render/common.js` (exists; do not edit)

```
NOISE_GLSL                                   hash/noise/fbm for shaders (vec2 versions)
PAINT, GLOW                                  vertex-colour materials (lit / unlit-HDR)
paint(geo, color, {p, r, s})                 clone+colour+place a primitive; color may be [r,g,b] with values > 1 (bloom)
merge(parts)                                 mergeGeometries(parts) -> one geometry
box, cyl, cone, sph                          primitive shorthands
radial(innerCss, outerCss, size=128)         radial gradient CanvasTexture
canvasTexture(w, h, draw(ctx, w, h))         any canvas texture (sRGB)
MeshPool(key, geo, mat, parent)              .take() / .give(mesh); meshes carry userData.pool = key
InstancePool(parent, geo, mat, cap)          .take(matrix, color) -> index | -1; .set(i, m); .give(i); .flush()
compose(x, y, z, sx=1, sy=sx, sz=sx, ry=0)   shared temp Matrix4 (copy if kept)
lerp, clamp01
```

Colour values above 1.0 on GLOW/MeshBasicMaterial bloom (UnrealBloom,
threshold 1.0). Keep authored albedo in linear-ish 0..1 terms; the renderer
uses ACES tone mapping with exposure ~0.9.

## Module: `render/theme.js`  (owner: sky agent)

```
export function getTheme(season, night, biome)  -> {
  skyTop, skyMid, horizon, fog: THREE.Color,      // sky gradient + fog (fog == horizon-ish)
  sun: THREE.Color, sunIntensity: number,         // directional light
  hemiSky, hemiGround: THREE.Color, hemiIntensity,
  ambient: number,
  cloud: THREE.Color, cloudShadow: THREE.Color,
  grass: THREE.Color, foliage: THREE.Color,       // base vegetation tints for the season
  water: THREE.Color,
  snow: number (0..1, 1 in winter),               // ground snow cover
  label: { jp: string, en: string }               // e.g. { jp: '春', en: 'Spring' }
}
export const SEASON_LABEL = [{jp:'春',en:'Spring'}, {jp:'夏',en:'Summer'}, {jp:'秋',en:'Autumn'}, {jp:'冬',en:'Winter'}]
export const BIOME_LABEL  = [{jp:'山',en:'Mountain shrine path'}, {jp:'都',en:'City'}, {jp:'郊外',en:'Suburbs'}, {jp:'海岸',en:'Coast road'}]
```
Palettes must be *specific*: spring = pastel dawn (peach → lavender), summer =
deep saturated blue with towering cumulus and a hot white sun, autumn = amber
and rose gold with long shadows, winter = pale grey-blue with a low white sun
and blue shadows. Night versions keep a hue (Shinkai: night skies are blue,
never black). Return new Color objects each call is fine; the renderer caches.

## Module: `render/sky.js`  (owner: sky agent)

```
export function makeSky() -> { group, update(dt, state, camera) }
   state = { night, season, seasonT (blend 0..1 to the *next* season), time, wind: THREE.Vector3, biome, dread }
```
Must contain, all in scene space (static; the camera is near the origin
looking down +z, i.e. towards the horizon at large +z):
* A sky dome (r≈400, BackSide, fog:false) with a **painterly Shinkai sky**:
  banded gradient from theme, towering cumulus built from fbm with lit edges
  (sun-facing side warm, underside `cloudShadow`), a sun disc with wide glow,
  stars + a slowly moving **comet with a split tail** at night (a nod to *Your
  Name*), and subtle noise banding. Season drives cloud coverage (summer
  towering, autumn wispy cirrus, winter overcast-light, spring soft).
* **God rays**: a few large additive planes/sprites fanning from the sun
  position, slowly rotating, fading with `night`.
* **Lens flare**: 3–5 small additive sprites placed along the line from the
  sun's screen position through the screen centre (compute from `camera`),
  intensity by sun visibility (night → 0).
* Distant landscape: Mount Fuji (bigger snow cap in winter), 3 ridge layers,
  a Tokyo-Tower silhouette (beacon blinks), coloured from the theme. In
  `coast` biome, a sea horizon plane with a moving shimmer (a large plane at
  y≈-0.5 far out, x>0 side) is welcome but keep it cheap.
* `update` sets every material colour from `getTheme` each frame (lerp toward
  it for smooth transitions, ~1 s).
Keep total draw calls under ~15.

## Module: `render/ground.js`  (owner: ground agent)

```
export const GROUND_W = 110
export const MAX_LIGHTS = 8
export function makeGroundMaterial() -> THREE.ShaderMaterial    (fog: true; uses THREE.UniformsLib.fog)
export function groundGeometry() -> PlaneGeometry(GROUND_W, CHUNK_LEN) rotated flat (XZ), centred
```
Uniforms (exact names): `uZ0` (chunk start z), `uTime`, `uBiome` (0..3),
`uSeason` (0..3), `uSnow` (0..1), `uNight`, `uWet` (0..1 rain), `uLightN`,
`uLight[MAX_LIGHTS]` (vec4: x, z, y, intensity), `uLightCol[MAX_LIGHTS]`
(vec3). The fragment shader gets world-ish coordinates: x across, and the
absolute track z (`uZ0 + CHUNK_LEN/2 + localZ`).
Draw:
* Two 3-lane tracks (|x| within each track: centres ±4.6, half-width 3.3)
  with a median strip (|x| < 1.3). Subtle lane guides at lane boundaries;
  a crisp edge line at the outer road edge (|x| = 7.9).
* Per biome: mountain = flagstone shrine path with moss between stones,
  median = raked gravel; city = wet asphalt, white dashes, crosswalk every
  chunk, median = concrete with painted stripe, puddles reflecting the light
  list (streaks toward the viewer); suburb = pale asphalt with a yellow centre
  line, gutters, median = low hedge green; coast = sandy road with tyre lines,
  median = rope-post gravel, the *left* verge (x<-8) fades into cliff rock and
  the right (x>8) into sand then sea (deep teal) beyond x>20.
* Per season: `uSnow` blends a snow layer over everything with tyre/foot
  tracks kept dark in the lanes; autumn scatters leaf specks (small warm
  blobs) in the verges; spring scatters petal specks; summer greener verges.
* Verges outside the road: grass (season tint), earth patches, darken with
  distance from the road so the instanced grass field blends in.
* Output linear colour: `pow(col, vec3(2.2))` on authored sRGB-like values,
  then `#include <fog_fragment>`.

## Module: `render/vegetation.js`  (owner: vegetation+fx agent)

```
export function makeGrass(parent) -> { fill(chunk, rng, season, biome), release(chunkIndex), update(dt, wind, night, season) }
export function makeFlowers(parent) -> same interface
```
* Grass: one InstancedMesh (~6000 crossed-quad blades, 2 quads each,
  vertex-coloured) with a **wind vertex shader** (`uTime`, `uWind`), bending
  from the base, gusts travelling along z (Ghost of Tsushima). Blade colour
  by season: spring fresh green, summer deep green, autumn gold/susuki
  (taller, plume-topped variant), winter sparse pale straw poking through
  snow. Fill both verges |x| ∈ [8.6, 40] for the chunk (not in city; sparse
  in suburb; coast only on the cliff side).
* Flowers: instanced quads/clusters: spring white+pink, summer yellow
  (sunflower fields in suburbs) and blue hydrangea (mountain), autumn **red
  spider lilies** in drifts, winter none (camellia red dots sparingly).
* Use `mulberry32` from `../core/rng.js` via the passed `rng` for placement so
  fills are deterministic per chunk.
* Keep per-frame CPU work near zero: sway is in the shader.

## Module: `render/fx.js`  (owner: vegetation+fx agent)

```
export function makeParticles(parent) -> { update(dt, {season, biome, night, scroll, wind, dread, mode}) }
```
Camera-space particle fields that scroll with the world (`scroll` = run speed):
sakura petals (spring, mountain/suburb), **falling leaves** (autumn: maple
red/orange, tumbling, wind-blown along +z), **snow** (winter: dense, slow,
drifting, more in `mountain`), fireflies (summer nights), rain streaks
(summer showers and whenever `dread` > 0.5 — the typhoon), dust motes in
sunbeams (afternoon). Cross-fade between modes over ~1.5 s. Add **wind
streaks**: thin translucent white ribbons flowing along the road (the guiding
wind), stronger in autumn and with the typhoon.
```
export function makeTrail(parent, color) -> { emit(x, y, z, dt, moving) , obj }   // spirit-fire trail in root space
export function makeTrain() -> Group (visible=false), body along -z→+z 44 m, nose at -z   // shinkansen on the city viaduct
export function makeShockRing(parent) -> { burst(x, z, color), update(dt) }         // ground ring on power pickup / shield break
```

## Module: `render/props.js`  (owner: props agent)

All obstacle/pickup geometry, merged with `paint`/`merge` so each prop is
**one Mesh**. Provide a deterministic catalogue the renderer can iterate:

```
export const OBSTACLES = {            // [biome][type] -> array of variants; each variant = { geo, mat, name }
  mountain: { stalk: [...4], arch: [...3], drusen: [...3], gap: [...1], wide: [...2], roller: [...1] },
  city:     { ... }, suburb: { ... }, coast: { ... }
}
export function buildObstacles() -> OBSTACLES (call once; builds geometry)
export function buildPowers() -> { shield, magnet, dash, x2, heal }  each { geo, mat, ring: THREE.Color }  // floating pickup icons ~0.9 m tall
export function buildRig(kind, matFactory) -> { group, body, head, tail, legs[4], ears?, mats }   // kind: 'kitsune' | 'tanuki'
export function coinGeometry() -> geometry (koban: an oval gold coin with a square hole, ~0.5 m)
```
Obstacle semantics (the sim decides the verb; props must read as that verb):
* `stalk` (change lane, ~2–2.5 m tall solid): mountain = stone lantern,
  bamboo cluster, jizō statue with red bib, cedar stump with shimenawa;
  city = vending machine (red / blue), pachinko sign pillar, maneki-neko
  statue, taxi-stand pole with sign; suburb = utility pole, red postbox,
  Shigaraki tanuki statue, garden lantern; coast = mooring bollard with rope,
  stacked crab pots, lighthouse-striped post, dried-fish drying rack.
* `arch` (slide under, beam at y≈1.05–1.3, posts outside the lane): mountain =
  small torii, shimenawa rope with shide, low branch with hanging ema;
  city = noren curtain, shop awning with lanterns, hanging kanji banner;
  suburb = level-crossing gate arm (striped, with a red lamp), laundry pole
  with futons, small inari torii; coast = fishing-net drape, driftwood beam.
* `drusen` (jump, ≤0.6 m tall, lane-wide): mountain = mossy boulder, fallen
  log, saisen offering box; city = construction barrier, bicycle rack with
  bikes, cardboard box stack; suburb = low garden wall, parked bicycle,
  flower planter; coast = tide-pool rocks, rope coil, beached buoy.
* `gap` (jump, 3 m deep hole in the road): a dark recess with edge detail per
  biome (broken flagstones / open manhole strip / storm drain / washed-out
  road with sea foam).
* `wide` (spans 2 lanes = 4.4 m wide, solid, 1.5–2.5 m tall): mountain =
  fallen cedar, city = delivery truck tail, suburb = parked kei car, coast =
  overturned fishing boat.
* `roller` (a moving solid, ~1.2 m, lane-sized): mountain = rolling sake
  barrel, city = salaryman on a bicycle, suburb = a Shiba running across,
  coast = a rolling buoy.
* All obstacles sit on y=0 at their local origin, facing -z (toward the
  runner), centred on x=0; the renderer positions them.
Rigs: low-poly, ~0.9 m tall, built from primitives; the fox (orange, cream
belly, black socks, white tail tip, 2 ears) and the tanuki (brown, dark eye
mask, striped tail, rounder body, a straw hat is a nice touch). `legs[i]` are
pivot Groups at the hip so the renderer can swing them; `tail` a Group at the
base. `matFactory(hex)` returns a Material — the renderer passes either
MeshStandardMaterial or a ghost material.

## Module: `render/scenery.js`  (owner: scenery agent)

```
export function buildScenery(parent) -> {
  dress(chunk, ctx),                     // called once per chunk when it is attached
  update(dt, state),                     // per-frame: blinking lights, crossing lamps, water shimmer
}
ctx = {
  rng,                                   // mulberry32 for this chunk (deterministic)
  z0, len,                               // chunk extent
  biome, season, night,
  take(name, x, y, z, { sx, sy, sz, ry, color }),   // place an instanced-prop; returns handle (renderer releases on recycle)
  prop(name, x, y, z, { ry, sx, sy, sz }),           // place a pooled single mesh; returns mesh
  light(x, z, y, intensity, [r,g,b]),               // register a road-reflecting light for the ground shader (max 8 per chunk)
  neon(text, color, x, y, z, ry, vertical),          // place a kanji neon sign (renderer-provided)
}
```
`buildScenery` must create all InstancePools / MeshPools it needs under
`parent` and expose them through `take`/`prop` by name; the renderer only
needs `dress`/`update` plus a `release(chunkIndex)` that frees everything
the chunk placed. So the signature is:
```
export function buildScenery(parent, neonFactory) -> { dress(chunk, ctx), release(chunkIndex), update(dt, state) }
```
with `ctx` reduced to `{ rng, z0, len, biome, season, night, light }` and
`neonFactory(text, color, vertical) -> Mesh` supplied by the renderer.
Dress each biome distinctly, and vary it by season:
* **mountain**: instanced cedars (cones + trunks), season trees (sakura
  spring / green maple summer / **red-orange momiji** autumn / bare or snowy
  winter), bamboo groves (Kyoto — summer & spring), stone lanterns and torii
  along the path, strings of chōchin (GLOW colours), ground mist planes,
  moss rocks, a small shrine (honden) every ~4 chunks, the big torii at the
  section entrance. Snow caps on everything in winter (a white cap part on
  trees/lanterns when `season===3`).
* **city**: instanced buildings (4 height variants, window texture with
  UVs scaled to keep window size), kanji neon via `neon()`, street lamps,
  the elevated viaduct on the right for the shinkansen, crosswalk signals,
  hanging power lines (LineSegments between poles), an entrance gantry.
  Autumn: ginkgo trees (yellow) on the pavement; winter: light dusting and
  warmer window glow; summer: awnings and a festival lantern row.
* **suburb**: low houses with hip roofs (dark blue/grey tiles), garden
  walls, utility poles with **catenary wires** (LineSegments), a konbini with
  a glowing sign, a level crossing with striped gates and blinking red lamps
  (`update`), rice paddies (flat green in summer, gold in autumn, flooded
  mirror in spring, stubble/snow in winter) on the far verge, bicycles,
  a small park with swings, a school in the distance.
* **coast**: cliff rock wall on the left (stacked instanced boulders),
  guardrail posts, pine trees bent by wind, a lighthouse every ~6 chunks,
  fishing boats and buoys on the right in the sea, a torii standing in the
  water (Itsukushima nod) once per section, seagull sprites, tetrapods.
Register road lights (lanterns, lamps, konbini sign, crossing lamps) with
`ctx.light` so puddles reflect them. Draw calls: instanced everything that
repeats; pooled singles only for one-per-chunk landmarks.

## Renderer responsibilities (owner: renderer — not an agent task)

Composes the above; owns cameras, lights (directional sun + hemisphere +
ambient from theme), the mirror stage, chunk attach/detach, coins
(InstancePool), obstacles from `OBSTACLES[biome][type][v % variants.length]`,
rollers moving per `rollerLaneAt`, power pickups bobbing + ring, the two rigs
(fox on track 1, tanuki on track 0), trails, shadows, the typhoon cloud bank,
post (bloom + a light anime grade), HUD hooks.
