# KITSUNE — Game Design Document

*A fox spirit and a tanuki run the old road through Japan as the seasons turn, a typhoon on their heels.*

| | |
|---|---|
| Genre | Fast-paced infinite runner, 1–2 players (shared keyboard), 3rd-person chase camera |
| Pillars | **Shinkai light** · **Ghibli ground** · **Tsushima wind** · one road, always fair, two bodies that collide |
| Session | 90 s – 6 min runs; a full year of seasons every 2 km |
| Shipped path | Web (Three.js, zero build) — prototype in `prototype/`; Unity/Unreal plans in §4 |

---

## 1. Concept & core loop

### 1.1 Fantasy
You are **Kitsune**, a fox spirit, running from the mountain shrines down through the city, the suburbs and along the coast road — and back around — while spring becomes summer, autumn, winter. **Tanuki** runs beside you: a mischievous spirit in single-player (auto-piloted, immune) or a second player. A **typhoon** follows the pair; it never stops, and every mistake lets it close.

### 1.2 The loop
```
run → read the next row (6 m ahead at 13–30 m/s) → verb (lane / jump / slide)
    → collect (coins, powers) → survive rows → section changes (biome, season)
    → typhoon margin rises on clean running, falls on hits → death when margin = 0
    → results: distance, score, coins, powers → run again (Seed of the Day)
```
A run breathes: difficulty is a base ramp modulated by a 5–7 chunk tension/release wave, and every ~6th chunk at high difficulty is a **torii wall** telegraphed by a clear beat.

### 1.3 Controls
| Action | 1P (fox) | 2P fox / tanuki | Touch | Gamepad (planned) |
|---|---|---|---|---|
| Lane left / right | ← → or A D | ← → / A D | swipe on your half | d-pad, stick |
| Jump (hold = higher) | ↑ / Space / W | ↑ Space / W | swipe up or tap | A |
| Slide, fast-fall in air | ↓ / S | ↓ / S | swipe down | B |
| Restart | R | R | tap after death | Start |

Inputs are buffered for 150 ms with 80 ms coyote time; a jump released early is a short hop (55 % velocity). Both runners share forward speed so the pair stays in frame.

### 1.4 Camera
Chase camera at (0, 5.2, −8.5) looking at (0, 1.3, +22), between the two home tracks. FOV 66° at base speed → 80° at max speed, +6° during a dash. Roll follows the average lane-change velocity (×0.25); jitter from stumbles (0.04 rad, decays e^−5t), typhoon lightning flashes an ambient light. The camera never rotates in yaw: the road is always straight, all information is in the lanes.

### 1.5 Obstacle grammar
The road is **six lanes** (2.2 m each): lanes 0–2 are the tanuki's home, 3–5 the fox's. Hazards are generated **per home track**, in rows every 6 m (a *beat*), six beats per 36 m *chunk*; the last beat of every chunk is clear (the *breath beat*), so chunks are independent and any client can build any chunk in any order.

| Cell | Verb | Mountain / City / Suburb / Coast props |
|---|---|---|
| `stalk` | change lane | stone lantern, bamboo, jizō, stump / vending machine, pachinko pillar, maneki-neko / utility pole, postbox, tanuki statue, garden lantern / bollard, crab pots, striped post, fish rack |
| `arch` | slide | torii, shimenawa, ema branch / noren, awning, banner / crossing gate, laundry pole, inari torii / net drape, driftwood beam, pennant line |
| `drusen` | jump | boulder, log, offering box / barrier, bike rack, boxes / garden wall, bicycle, planter / tide rocks, rope coil, buoy |
| `gap` | jump | broken flagstones / open manhole / storm drain / washed-out road |
| `wide` | take the third lane | fallen cedar / truck tail / kei car / overturned boat (spans 2 lanes) |
| `roller` | the lane it never visits, or timing | sake barrel / salaryman on a bicycle / running Shiba / rolling buoy (sweeps 2 lanes) |

**Solvability guarantee.** Rows are committed only if the *reach set* — the lanes a runner can actually be in after the previous row, one lane-step per row — still contains a passable lane, with `wide`/`roller` marks treated as blocking and no forced double action (an `arch` after a `drusen` in the same lane is only allowed if a side-step exists). 240,000 tracks are DP-verified in the test suite. A runner who stays on their home track can therefore always survive; crossing over is a choice.

**Barging.** When the two bodies overlap at the same height, the one *moving* into the other shoves it one lane sideways (0.4 s stumble, no margin cost); at the road edge or head-on, movers bounce back. A runner 0.8 m above the other passes over. A 0.35 s cooldown prevents ping-pong. A shove can put the victim in front of a lantern — that is the sabotage.

### 1.6 Powers (Japanese mythology)
| Power | Icon | Effect | Weight |
|---|---|---|---|
| **Kitsune Spirit Shield** | omamori charm | absorbs one stumble or fall | 26 % |
| **Tanuki Coin Magnet** | blue kitsunebi flame | 10 s: coins on your track in any lane | 24 % |
| **Wind Kami Dash** | geta with wind rings | 3.5 s: invulnerable, clears everything | 20 % |
| **Daruma Double** | daruma | 12 s: ×2 coins and distance score (shared) | 15 % |
| **Sakura Heal** | blossom branch | +14 m typhoon margin (shared) | 15 % |

Second tier (design): **Raijin Slow-time** (4 s at 0.6× sim speed), **Tengu Glide** (hold jump to float 2 rows), **Kappa Water-run** (coast: run on the sea lane for 8 s).

### 1.7 Kaiju encounters
The last two chunks of every season (72 m before the change) belong to a **kaiju**: it rises far down the road, strides ahead of the pair and throws its signature hazards back at them. Throws are ordinary cells generated through the same grammar (so every row stays solvable) with a `thrown` flag: the renderer flies each one in an arc from the monster's hand and lands it with a dust ring; a **wave** is a full-width shockwave line that every lane must jump. A HUD warning names the monster.

| Season | Kaiju | Throws |
|---|---|---|
| Spring | **Daidarabotchi**, the mountain giant | boulders (lane), small rocks (jump), stomp waves |
| Summer | **Umibōzu**, the sea giant | fishing boats (two lanes), buoys (jump), waves |
| Autumn | **Gashadokuro**, the starving skeleton | bone spikes (lane), skulls (jump), ribcages (two lanes) |
| Winter | **Yuki-Oni**, the snow ogre | ice blocks (lane), snowballs (jump), frost waves |

### 1.8 The typhoon
`storm` starts at 30 m of margin (max 34). Clean running recovers 0.6 m/s; pressure drains up to 0.45 m/s by 2.5 km; a stumble costs 7 m, a stalk 11 m, a fall 14 m and a respawn with 1.2 s grace; each coin returns 0.25 m. The cloud bank descends from the top of the frame with the deficit, rain and lightning rise from 45 %, and death is only at 0. In 1P the companion's hits are free; in 2P both runners share the bar — barging your partner into a wall costs you too.

### 1.9 Progression
Seed of the Day for shared leaderboards, distance/coin milestones unlock cosmetic trails and companion hats, a *Dream Journal* of sections seen (e.g. "winter coast at night"). No timers, revives or loot boxes.

---

## 2. Level generation & environment

### 2.1 Structure
```
chunk (36 m) = 6 beats × 6 m; beat 6 always clear
biome section = 8 chunks (288 m): mountain → city → suburb → coast → …
season section = 14 chunks (504 m): spring → summer → autumn → winter → …
time of day = golden hour ↔ night, one cycle per 3.6 km
```
Because biome and season periods differ (8 vs 14), the combinations rotate: the first year passes mountain-spring, city-spring, suburb-summer, coast-summer, mountain-autumn…, and the same biome is never seen twice in the same season until the sequence wraps (LCM 56 chunks ≈ 2 km).

### 2.2 Seamless transitions
* **Palette**: every colour (sky bands, fog, sun, hemisphere, cloud, grass, water) comes from `getTheme(season, night, biome)` and is lerped over ~1 s each frame; there is no cut.
* **Ground**: the chunk shader takes `uSnow` = 0..1, building over the first two chunks of winter and melting over the first two of spring, with packed dark tracks in the lane centres.
* **Vegetation**: fills are per chunk, so a boundary is a row of trees where the tint changes; `seasonBlend` fades early-autumn foliage green→red and late-spring sakura pink→green.
* **Particles**: modes cross-fade over 1.5 s (petals → none → leaves → snow); wind ribbons persist across all of them.
* **Landmarks** mark entrances: a large torii into the mountains, a highway gantry into the city; a lighthouse and an in-water torii on the coast.

### 2.3 Palette table (sky top / horizon / fog / foliage)
| | Spring | Summer | Autumn | Winter |
|---|---|---|---|---|
| Mountain | `#7d8fd8` `#ffd0a4` `#f2c9ba` sakura `#ffb7d5` | `#1a45b8` `#c2e6f7` `#b8dcf0` cedar `#2f8038` | `#c46b3a` `#ffd08a` `#e8b490` momiji `#e0431e` | `#8fa8c4` `#e9eef6` `#d8e0ea` bare `#6b6f77` snow `#f3f4fa` |
| City | neon on pastel `#ff3fa4 #3fe0ff` | high sun, hard shadows `#fffcf2` | ginkgo `#f2c230`, amber signs | warm windows `#ffe9b0`, blue snow |
| Suburb | flooded paddies mirror the sky | sunflowers `#ffd23f`, cicada haze | gold paddies `#d9a441` | stubble under snow, crossing lamps red |
| Coast | pale sea `#82bad9` | deep teal `#1a8db2`, showers | rose-gold water | grey-blue swell, spray |
Night keeps a hue in every season (Shinkai: never black): tops `#0f1a4c`–`#061038`, horizons `#5f4b82`–`#2d5092`.

---

## 3. Visual & audio direction

### 3.1 Shaders
* **Sky dome** — banded gradient with subtle painterly banding; fbm cumulus sampled on a plane above the viewer and lit by re-sampling toward the sun (warm edge, `cloudShadow` underside); cirrus wisps; sun disc + glow; hash stars; a comet with a split tail (night); coverage by season (summer towering, autumn cirrus, typhoon adds cover).
* **God rays & flare** — seven additive ray planes rotating around the sun; a five-sprite flare chain along the sun→centre line, fading with dread and night.
* **Ground** — six-lane road with per-biome surfaces, puddles reflecting the chunk's eight registered lights as streaks toward the viewer (soft-clamped), snow layer, leaf/petal specks, verge darkening; `pow(2.2)` then fog.
* **Wind vertex shader** — grass blades and susuki plumes bend from the base by `uv.y²`, with travelling gusts along z and a global wind vector (autumn 1.3×, typhoon +1.2).
* **Post** — UnrealBloom (threshold 1.0, so only HDR emitters bloom: neon, lanterns, coins, kitsunebi), an anime grade (vibrance +14 %, blue shadow lift, soft vignette), ACES.

### 3.2 Particles & weather
Sakura petals (spring, drifting), tumbling maple leaves (autumn, wind-blown forward and sideways, per-point rotation), snow (winter, dense and slow), fireflies (summer nights), rain streaks (summer showers, typhoon), dust motes in sunbeams, and **wind ribbons** — thin white streaks flowing along the road, stronger in autumn and as the storm nears. Spirit-fire trails behind both runners; shock rings on pickups, shield breaks and barges.

### 3.3 Lighting
Directional sun from front-right (warm `#ffb070` at golden hour → cool `#6a7fd0` moonlight), hemisphere sky/ground from the theme, a blue fill from behind, and a point light on each runner. Night multiplies surfaces by 0.45 but keeps emitters and reflections strong, so the city reads brighter at night than at dusk.

### 3.4 Audio (design)
* **Instruments**: shakuhachi lead in the mountains, koto arpeggios in spring, shamisen drive in the city, taiko for the typhoon, hichiriki drones on the coast; a lo-fi drum bed and a cinematic string pad underneath.
* **Adaptive layers**: biome selects the lead, season the mode (spring major pentatonic, autumn minor, winter sparse), dread crossfades in taiko and rain; speed adds hi-hat density.
* **SFX**: footfalls per surface (stone, asphalt, sand, snow), coin chime (koban clink), power jingles (bell for shield, whoosh for dash, wood block for daruma), barge thud + "ドン", torii slide whoosh, lantern clip crack, typhoon rumble and lightning.

---

## 4. Engine implementation plan

### 4.1 Shipped: web (Three.js)
Pure sim (`core/`) with fixed 60 Hz ticks, deterministic from (seed, input log), replayable for validation; renderer composes theme, sky, ground, scenery, vegetation, fx and props modules (contract in `RENDER_API.md`). Chunk pooling: 8 live chunks, each attach/detach moves pooled meshes and instance slots (no allocation in the loop). Budget: ≤ ~120 draw calls, ≤ 250k triangles, particles ≤ 2,500 points.

### 4.2 Unity (recommended for stores)
* **Terrain**: `ChunkPool : MonoBehaviour` with a ring of 8 chunk roots; generation in a Burst job from `(seed, index)` returning a `NativeArray<Cell>`; floating origin by shifting the root every 1 km.
* **Objects**: `ObjectPool<T>` per prop variant; `Graphics.RenderMeshInstanced` for trees, grass, coins; obstacles as prefabs with a `CellView` component reading the cell record.
* **Shaders**: Shader Graph equivalents of the sky, ground and wind shaders; season/night via global shader properties (`Shader.SetGlobalFloat`), per-chunk `MaterialPropertyBlock` for `uZ0`, `uSnow`, light lists.
* **Post**: URP bloom + a custom color-grading LUT per season pair, VFX Graph for particles.
* **Budgets**: mobile 60 fps at 1080p → ≤ 150 draw calls, ≤ 300k tris, 1 shadow-casting light; PC 144 fps → 2 lights, 4K bloom.

### 4.3 Unreal alternative
PCG framework for chunk dressing, Niagara for particles/wind ribbons, Nanite off (instances are cheap already), Lumen off on mobile; the sim as a plain C++ class ticked at 60 Hz for determinism; Material Parameter Collections for season/night.

### 4.4 Milestones
1. **Vertical slice** (done in prototype): sim, two runners, barging, four biomes × four seasons, powers, typhoon.
2. **Feel**: audio layers, gamepad, haptics, camera polish, difficulty telemetry.
3. **Meta**: Seed of the Day boards, Dream Journal, cosmetics, companion hats.
4. **Tier-2 movement**: wall-run (a `wall` cell on the road edge that a lane-change *into* converts to a 2-beat run along the wall; solvable as a passable lane), grapple (an `anchor` cell overhead: jump + jump swings two beats forward, skipping a row — the grammar treats the skipped row as clear for that lane).
5. **Online**: Shared-typhoon rooms (see the original Shared Nerve design in `GAME_DESIGN.md`).
