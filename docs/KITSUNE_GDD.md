# KITSUNE · 狐 — Game Design Document

> *A fox spirit runs the old road from the mountain shrines to the sea, a tanuki at her side and a typhoon at her back. The road shifts; the year turns; the wind shows the way.*

| | |
|---|---|
| **Version** | 1.0 — supersedes the VITREOUS-era `GAME_DESIGN.md` as the design of record. `TECHNICAL_BLUEPRINT.md` remains the reference for netcode and the pure-sim architecture. |
| **Genre** | 3D endless runner, two runners on one six-lane road, single-player with a spirit companion or two players on one keyboard |
| **Platforms** | Web (Three.js, shipped path) → iOS/Android → PC/console (Unity port, §4) |
| **Session** | 60–180 s per run, 6–10 runs per session |
| **Status of the prototype** | Everything in §1.5–1.8 marked **[proto]** is implemented in `prototype/src/core/`. Everything marked **[next]** is designed here and not yet built. |

### Creative pillars

1. **Cinematic Japan.** Makoto Shinkai's light (banded skies, lens flare, wet reflections, a comet at night), Studio Ghibli's hand-painted depth (layered ridges, dense vegetation, soft painterly noise) and Ghost of Tsushima's living air (guiding wind, leaves, petals, weather that *arrives*).
2. **A road that turns through provinces and seasons without a single cut.** Kyoto bamboo, Fuji ridgelines, Hokkaido snow, torii shrine paths, coastal cliff roads, Tokyo neon and quiet suburbs; spring → summer → autumn → winter every two kilometres, blended in-run.
3. **Fluid speed, fair rules.** Lane, jump, slide and barge today; wall-run and grappling-hook swing next — every verb slots into a lane grammar that is *provably* solvable, so a death is always the player's, never the generator's.

---

## 1. Game Concept & Core Gameplay Loop

### 1.1 Premise

Kitsune, a young fox spirit, has been told the shrine is moving to the sea. She runs the pilgrim road to follow it, and a tanuki — mischievous, loyal, better at coins than at hazards — runs beside her. Behind them comes a typhoon that was already there when the story began. There are no cutscenes: the road tells the story through the landscape it passes, and every 500 m an **ema** (a wooden votive plaque) is found on the roadside and added to the *Ema Wall* in the menu.

### 1.2 Core loop

```
   ┌───────────────────────────────────────────────────────────────────┐
   │ RUN ─► read the row (6 m ahead per beat) ─► verb ─► clean/coins   │
   │  ▲                          │                       │             │
   │  │                    barge / cross-over         margin ↑         │
   │  │                          │                    typhoon recedes  │
   │  └── stumble / fall ────────┴────────────────► margin ↓           │
   │                                              typhoon closes       │
   │            margin ≤ 0  ─►  "The storm took the road."             │
   └───────────────────────────────────────────────────────────────────┘
   DEATH ─► bank coins ─► ema found? ─► ONE-TAP RETRY (< 1 s, same seed)
```

The fox never dies from a single hit. Every mistake costs **typhoon margin** (§1.8); the storm is the only thing that ends a run. That is the whole emotional design: pressure accumulates, it is visible in the sky, and a clean stretch of running lets you breathe again.

### 1.3 Controls

Both runners share every verb. Inputs are buffered for 0.15 s and stamped with the sim tick, so a replay is `seed + input log` **[proto]**.

| Verb | 1P keyboard (fox) | 2P shared keyboard | Touch (1P: whole screen · 2P: left half = tanuki, right half = fox) | Gamepad |
|---|---|---|---|---|
| Lane left / right | `←` `→` or `A` `D` | Fox: `←` `→` · Tanuki: `A` `D` | Swipe left / right | Left stick / D-pad L/R, `LB`/`RB` |
| Jump (hold ≤ 0.18 s for full height) | `↑` `W` `Space` | Fox: `↑` `Space` · Tanuki: `W` | Swipe up or tap | `A` / Cross |
| Slide (in air: fast-fall) | `↓` `S` | Fox: `↓` · Tanuki: `S` | Swipe down | `B` / Circle, or stick down |
| **Wall-run [next]** | Lane input *outward* while on an edge lane beside a wall segment | Same | Swipe outward on an edge lane | Stick outward on an edge lane |
| **Grapple [next]** | `Shift` / `E` | Fox: `Shift` · Tanuki: `Q` | Two-finger tap, or long-press ≥ 180 ms | `X` / Square, `RT` |
| Restart | `R` | `R` | Tap after death | `Start` |
| Mode select | `1` (1P + companion) · `2` (2P) | — | Buttons on the title card | — |

Design notes: a tap is a jump because a jump is the most forgiving verb (drusen and gaps, 70 % of hazards). Touch swipes commit on `pointerup` with a 24 px dead zone. A second gamepad drives the tanuki in 2P; one gamepad plus keyboard is also valid.

### 1.4 Camera

Third-person chase, positioned behind the *pair*, biased toward the fox.

| Parameter | Value | Notes |
|---|---|---|
| Base offset | `(0, 5.2, −8.5)` from the runners' shared z **[proto]** | Camera lives at scene origin; the world scrolls under it (floating origin, §4). |
| Lateral follow | `x = 0.35 · fox.x + 0.15 · tanuki.x` **[next]** | Keeps both bodies on screen on a 6.6 m half-road while the fox stays near centre. Smoothed at 6 s⁻¹. |
| Height follow | `y += (5.2 + 0.25·avgY − y) · min(1, 6·dt)` **[proto]** | A jump lifts the camera by a quarter of the jump. |
| FOV curve | `66° + 14° · clamp01((speed − 13)/(30 − 13))`, `+6°` during Wind Kami Dash, `+4°` during a grapple swing | Lerped at 3 s⁻¹; 66° at the start, 80° at 30 m/s. Speed is *felt* through FOV and scroll rate, never through a shorter reaction window (see §1.5). |
| Lean (roll) | `roll = −0.25 · Σ runnerLean`, where `runnerLean → −0.05 · lateralVelocity` at 10 s⁻¹ | Lane changes tilt the frame ~2–3°. Wall-run adds a fixed 12° roll toward the wall over 150 ms. |
| Shake | Amplitude by event: barge 0.35, stumble 0.5, fall 0.9, death 1.4; decays `e^(−5t)`; jitter = `0.04 rad · amp · sin(67 t)` **[proto]** | Additive to roll only, never to position — keeps the lane grid legible. |
| Dread tilt | Pitch down `1.5° · dread` and lower the horizon as the storm closes | The cloud bank descends from y = 34 to y = 10 in camera space at full dread. |
| Reduced motion | FOV fixed at 70°, no roll, shake amplitude × 0.25, wind ribbons off | Toggle in settings and `?reduced=1`. |

### 1.5 Obstacle grammar

The road is **six lanes** (`LANE_W = 2.2 m`), two three-lane tracks with no median: the tanuki's home is track 0 (x < 0), the fox's is track 1 (x > 0). Hazards are generated **per track**, so each track is solvable alone; runners may cross into the other track but never need to. A chunk is 36 m = 6 beats of 6 m; one hazard row per beat **[proto]**.

| Cell | Verb | Geometry | Miss → margin cost | Shrine / bamboo / Fuji / Hokkaido | City | Suburb | Coast |
|---|---|---|---|---|---|---|---|
| `stalk` | change lane | solid, 2–2.5 m tall, one lane | −11 m (stumble, knocked back to the previous lane if clipped mid-change) | stone lantern, bamboo cluster, jizō, cedar stump with shimenawa | vending machine, pachinko pillar, maneki-neko | utility pole, postbox, Shigaraki tanuki | bollard, crab pots, striped post |
| `arch` | slide | beam at y 1.05–1.3 m, posts outside the lane | −7 m | small torii, shimenawa rope, ema branch | noren, awning, kanji banner | crossing gate arm, laundry pole, inari torii | net drape, driftwood beam |
| `drusen` | jump | ≤ 0.6 m, lane-wide | −7 m | mossy boulder, fallen log, saisen box | construction barrier, bike rack | garden wall, planter | tide-pool rocks, buoy |
| `gap` | jump (`y > 0.25` at centre) | 3 m hole | **fall**: −14 m, respawn in lane with 1.2 s grace | broken flagstones | open manhole strip | storm drain | washed-out road |
| `wide` | take the third lane | solid, spans 2 lanes | −11 m | fallen cedar | delivery-truck tail | parked kei car | overturned boat |
| `roller` | take the lane it never visits, or time it | solid 1.2 m sweeping between `lane` and `lane + dir` over 150–210 ticks | −11 m | rolling sake barrel | salaryman on a bicycle | a Shiba dashing across | rolling buoy |
| `wall` row | slide through the one open lane | stalks in two lanes + arch in the third, preceded by a **clear telegraph beat** | as stalk / arch | torii wall | shutter gantry | crossing barrier | breakwater |
| `photon` | collect | koban coin, `hi` variant floats over a drusen | +0.25 m margin, +10 score × streak bonus | | | | |
| `power` | collect | a floating icon ~0.9 m | see §1.7 | | | | |

**The per-track solvability guarantee [proto].** A row of a track is accepted only if the *reach set* — the lanes a runner can actually occupy after the previous row — contains a passable lane within one lane-change of a passable lane in the new row:

```
stepReach(mask, reach, prev):
  if count(blocking cells in mask) > LANES − 1: reject          // never 3 blockers in 3 lanes
  for each lane l passable in mask (not stalk/gap/wide/roller):
    for d in {−1, 0, +1}:
      if reach[l+d]:
        // no forced double action: arch→drusen (or reverse) in the same lane
        // with both neighbours blocked would need slide+jump inside 0.2 s
        if d == 0 and ACTION[mask[l]] and ACTION[prev[l]] and they differ
           and neither neighbour is (reachable and passable): continue
        newReach[l] = true
  return newReach if any else reject
```

Four rules make this a guarantee and not a hope:

1. **Breath beat.** The last beat of every chunk is empty, so every chunk starts with the full reach set and `generate(seed, index)` is a pure function — chunk 41 can be built without chunk 40, on any client or on the server.
2. **One lane change per beat is always possible.** `BEAT_LEN / SPEED_MAX = 6 / 30 = 0.2 s > LANE_T = 0.15 s`. The reaction window never shrinks with speed; only the number of rows per second does, which is why speed is capped at 30 m/s.
3. **Telegraphed walls.** A wall row is preceded by a clear beat and only spawns when `diff > 0.7` every 6th chunk.
4. **Twelve tries, then empty.** If a random row fails `stepReach` twelve times, it is replaced by an empty row. Fairness is preferred over density.

`tests/chunks.test.js` runs an independent DP over 2 000 seeds × 60 chunks × 2 tracks and asserts a path exists through every one. Any new verb (§1.6) must leave that test green **without modification** — see the additive rule.

**Barge rules [proto] and why they are fair.** The two bodies collide when `|Δlane| < 0.85` at similar height (`|Δy| ≤ 0.8`), with a 0.35 s cooldown:

| Situation | Result |
|---|---|
| A is changing lane toward B, B is not | B is shoved one lane in A's direction and stumbles 0.4 s. A continues. |
| Both moving into each other | Both bounce back to their origin lanes and stumble 0.4 s. |
| Victim is on the road edge (lane 0 or 5) | The *mover* bounces instead — you cannot push someone off the road. |
| Both standing in overlap (post-respawn) | The one with room gets shoved; if neither, the other. |
| Either runner airborne relative to the other | No collision — a jump is always a clean way past a barge. |

Why this is fair: (a) the shove is one lane, never two, and always to a lane that exists; (b) the victim keeps every verb — a 0.4 s stumble slows the pair but does not disable jump or slide; (c) in KITSUNE a fall is a −14 m margin cost and a respawn, not a death, so a barge can never end a run by itself; (d) the mover pays symmetric risk: bouncing costs the same 0.4 s stumble, and while the fox is on the tanuki's track she is playing rows generated for a runner who is also there; (e) the companion AI is forbidden from moving within 1.2 lanes of the human, so in single-player barging is always the player's choice.

### 1.6 Next-tier movement: wall-run and grapple [next]

Both are **additive verbs**: they are placed only where the row is already solvable with lane/jump/slide, they open a faster or safer line, and the DP that guarantees solvability ignores them entirely. This keeps the 120 000-chunk test valid unchanged, lets accessibility mode disable them, and keeps the companion AI simple (it does not use them).

**Wall-run.** Wall segments run along the road edge beside lane 0 or lane 5 (the cliff, a temple wall, a shutter row, a breakwater) for 2–3 beats (12–18 m).

| Rule | Spec |
|---|---|
| Entry | On lane 0 (or 5), a lane input *outward* while a wall segment overlaps the runner's z. Buffered like any input. Runner moves to virtual lane −1 (or 6) at `x = ±7.6`, `y = 1.2`, in 0.15 s with a 12° body roll. |
| While on the wall | Immune to every ground cell in the adjacent edge lane; collects `hi` coins strung along the wall at y 1.6. Speed unchanged. Jump off the wall = a lane change back inward *plus* a 0.7× jump — the only way to cross two lanes in one beat. |
| Exit | Automatic at the segment's end; the runner lands in the edge lane. **Generator constraint:** the row after a wall segment always has its edge lane passable (same trick as the breath beat), so an exit can never dump you into a stalk. |
| Placement | `wallChance` 0 → 0.18 with difficulty, at most one segment per track per chunk, never on a wall-row beat, never in city intersections (no wall there). Segments sit over beats whose edge lane holds an arch/drusen/gap, so the wall is an alternative to slide/jump, not free space. |
| Scoring | +5 per cell passed on the wall, +25 near-miss flash if the edge lane held a gap. |

**Grapple (the kagi-nawa).** Anchors are overhead points above a lane: a torii crossbeam, a lantern hook, a crane arm, a rope bridge post.

| Rule | Spec |
|---|---|
| Availability | An anchor 6–14 m ahead in the runner's lane or an adjacent lane. The HUD shows a small ring on the anchor while it is in range (0.3 s minimum window at 30 m/s, 0.6 s at 13 m/s). |
| Swing | Press Grapple: the rope attaches, the runner leaves the ground and follows a circular arc under the anchor (anchor height 4.2 m, rope 3.0 m, apex 3.2 m). The arc covers exactly **two beats** (12 m); landing is in the anchor's lane on the third beat, with 0.2 s of landing grace. Lane inputs during the swing are ignored; slide = early release (fast-fall, lands one beat early). |
| Placement | Anchors are placed only above rows of type `gap`, `drusen`, `arch` or empty — the swing passes above beams (1.3 m) and boulders. **Never above a `stalk`/`wide`/`roller` row**: solids are 2–2.5 m tall and the arc's minimum height near the rope ends is 1.2 m. The landing row's anchor lane is always passable. `grappleChance` 0 → 0.12 with difficulty; release chunks always carry one anchor above the coin river as a tutorial. |
| Why it is safe under the DP | Every crossed row is a row the runner could have solved by jump or slide; the grapple is a spectacle line with `hi` coins on the arc (+3 coins), not an escape line. |
| Two-player | Each runner grapples independently; no collision while one is airborne. In 2P a rope *can* be shared: if the tanuki grapples the same anchor within 0.25 s, both swing and the pair earns a **Kizuna** bonus (+50). |

"Sliding under shrine gates" is the `arch` verb; "leaping across stone lanterns" is a **lantern-hop row** [next]: a row of three low toro (0.6 m, `drusen`-class) with `hi` coins strung between them, spawning on release chunks in shrine provinces.

### 1.7 Power-ups

Spawn 30 % per track per chunk from chunk 2 on, in a free lane at beat 1–4. Pickup by lane overlap or by magnet.

| Tier 1 [proto] | Myth | Effect | Duration | Weight |
|---|---|---|---|---|
| **Kitsune Spirit Shield** (狐火) | A fox-fire ward; the hoshi-no-tama orb | Absorbs one stumble *or* one fall (no margin cost, no respawn) | Until spent | 0.26 |
| **Tanuki Coin Magnet** (小判) | The tanuki's bottomless purse of leaf-money | Collects coins and powers from any lane on the road | 10 s | 0.24 |
| **Wind Kami Dash** (風神) | Fūjin's bag of wind | Invulnerable, clears every cell in the path as "clean", cures stumble, +6° FOV, speed lines | 3.5 s | 0.20 |
| **Daruma Double** (達磨) | Both eyes painted — a wish granted twice | Coins and distance score ×2 | 12 s | 0.15 |
| **Sakura Heal** (桜) | A blossom off the season's first tree | +14 m of typhoon margin, the sky brightens for 2 s | Instant | 0.15 |

| Tier 2 [next], from chunk 20 | Myth | Effect | Duration | Weight (tier 2 pool = 25 % of spawns) |
|---|---|---|---|---|
| **Raijin Slow-time** (雷神) | The thunder god's drum stops the sky | Sim distance advances at 0.6×; runner timers (lane, jump, slide) unchanged, so every row gives 1.67× reaction time. Typhoon pressure paused. Score unaffected. Sky desaturates, drum hit on start/end. | 4 s | 0.40 |
| **Tengu Glide** (天狗) | The mountain goblin's feather fan | Holding Jump at the apex sets gravity to 0.25× for up to 1.2 s: crosses one extra row airborne, clears `drusen`/`gap`/`arch` under it. Cannot pass stalks. | 8 s (re-usable per jump) | 0.35 |
| **Kappa Water-run** (河童) | The river spirit lends its plate of water | `gap` cells resolve as clean with a splash; puddles and rain show the fox's reflection running on water. In coast biome and typhoon rain the pickup is 2× as common. | 8 s | 0.25 |

Rule for every power: none changes hitboxes permanently, none is purchasable, and every effect has a visual on the runner, a sound, and a HUD timer ring.

### 1.8 The typhoon and the margin economy [proto]

The typhoon is a distance behind the pair, `storm ∈ [0, 34]` metres. `dread = 1 − storm / 34` drives the sky, rain, wind, lightning and music.

| Term | Value | Per km at 30 m/s |
|---|---|---|
| Start / max margin | 30 m / 34 m | |
| Recovery while both runners are clean | +0.6 m/s | +20 m |
| Pressure (rises with distance) | −0.45 m/s × min(1, d / 2500) | −15 m at full pressure |
| Net while clean at full pressure | +0.15 m/s | +5 m |
| Stumble (arch/drusen miss) | −7 m | |
| Solid hit (stalk/wide/roller) | −11 m | |
| Fall (gap) | −14 m, respawn, 1.2 s grace | |
| Coin | +0.25 m | a 4-coin line = +1 m |
| Sakura Heal | +14 m | |
| Death | `storm ≤ 0` | |

What this produces: from a full 34 m the pair survives three falls, or five arch misses, in quick succession. At full pressure a single stumble takes ~47 s of clean running (1.4 km) to earn back — so coins are not decoration; 28 coins repay a stumble, and a release chunk's coin river (24 coins per track) repays most of one. The stumble multiplier (0.72× speed for 1 s) is the only thing that slows the pair, which is why it hurts. The cloud bank in the top of the frame descends linearly with dread; lightning starts above dread 0.45; rain starts above 0.35.

**Tuning envelope** (ship values may move within these): pressure cap distance 2 000–3 000 m, recovery 0.5–0.7 m/s, fall cost 12–16 m. Keep `STORM_MAX − STORM_START = 4` so the first mistake is always survivable.

### 1.9 Single-player with the companion vs. two players

| | 1P + spirit companion **[proto]** | 2P shared keyboard **[proto]** |
|---|---|---|
| Who runs | Fox = human. Tanuki = autopilot on its home track. | Fox = P1 (arrows/Space), Tanuki = P2 (WASD). |
| Whose mistakes cost | Only the fox's. The tanuki's stumbles and falls are "free" (it is a spirit); a HUD wisp shows it flinch. | Both. The margin is shared; the pair lives and dies together. |
| Shared speed | The fox's stumble slows both. | Either runner's stumble slows both. |
| Barging | The companion never moves within 1.2 lanes of the fox. The fox may cross over and barge it — for coins, or for fun. | Full barge rules. Barging your partner is legal, costly to both, and the point of couch play. |
| Coins | Both runners' coins count for the pair. The companion weights coins ×1.5 and powers ×5 in its lane choice, so it is the "coin runner". | Shared score and coins. |
| Powers | Picked up by whoever touches them. `x2` and `heal` are shared; `shield`/`magnet`/`dash` belong to the body. | Same. |

**Companion autopilot [proto].** Deterministic, sim-state only, issues ordinary logged inputs (replays stay pure). Looks ahead `4 + min(16, 0.7 · speed)` m on its home track, builds per-lane verdicts for the next two rows (`free / jump / slide / block`), scores lanes (`free` +10, `block` −100, action +4, next-row free +3, coins ×1.5, distance from current lane −1.2, within 1.2 lanes of the human −40), changes lane only when `dz > speed · (0.15 + 0.12)`, and acts (jump/slide) when `dz ≤ 0.3 · speed`. It fast-falls after clearing a hazard if the next row is close. Companion personality [next]: a 4 % chance per row of a deliberate late action so it visibly *tries*, and a bark 0.5 s before a wall row (the audio telegraph for the human's track, §3.5).

### 1.10 Session shape and progression

- **Speed** `v = min(30, 13 + 6.5 · log2(1 + d / 350))` m/s: 13 at the start, 24 at 1 km, 30 by ~2.5 km. A 90 s run covers ~2 km — one full year of seasons.
- **Seed of the day** — one global seed, one leaderboard, validated by server replay (blueprint §2.5).
- **Ema Wall** — 24 votive plaques at cumulative and single-run distance milestones; each is one line of the fox's story.
- **Three daily omikuji** — small objectives ("slide under 12 torii", "barge the tanuki 3 times", "grapple 5 anchors").
- **Cosmetics only:** fox masks (kitsune-men), tail fire colours, tanuki hats, spirit-trail colours, and *Kami Lenses* (camera presets, always free). No energy timers, no hitbox upgrades, no purchasable revives.

---

## 2. Level Generation & Environment System

### 2.1 Structure [proto]

| Unit | Length | Contents |
|---|---|---|
| Beat | 6 m | One hazard row per track |
| Chunk | 36 m (6 beats) | 5 hazard beats + 1 **breath beat** (always empty) |
| Biome section | 8 chunks = 288 m | `mountain → city → suburb → coast`, repeating |
| Season section | 14 chunks = 504 m | `spring → summer → fall → winter`; a full year every 2 016 m |
| Super-cycle | 224 chunks ≈ 8 km | Every biome meets every season (`lcm(32, 56)`) |
| Pool | 6 chunks ahead, 1 behind, ring buffer | `generate(seed, index)` is pure; meshes are recycled, never allocated |

**Breathing difficulty.** `base = 0.2 + 0.8·(1 − e^(−index/32))`; a seeded period of 5–7 chunks with 70 % tension / 30 % release; `diff = base · (0.55 + 0.45 · wave)`. Chunks with `wave < 0.2` are **release chunks**: no hazards, a coin river per track, a grapple anchor, the province's set-piece (a honden, a lighthouse, a shinkansen passing). Difficulty drives hazards per beat (0–1 → 1–2), blocking share (20 → 50 %), combos (0 → 30 %), `wide` (0 → 22 %), `roller` (0 → 16 %), walls every 6th chunk above 0.7.

### 2.2 Provinces [next]

The four sim biomes become seven *provinces*. The mountain biome is dressed differently by season so the run visits four famous landscapes without changing the sim:

| Sim biome | Season | Province dressing | Signature set-piece (release chunk) |
|---|---|---|---|
| mountain | spring | **Torii shrine path** — cedar, sakura, vermilion torii tunnel (Fushimi Inari) | The thousand-gate tunnel: 12 arches in one lane, a coin river beneath |
| mountain | summer | **Kyoto bamboo grove** (Arashiyama) — dense culms, dappled light, hydrangea | A bamboo corridor with wind-bent culms crossing overhead as anchors |
| mountain | fall | **Fuji ridgeline** — momiji, susuki grass, Fuji filling the horizon | A ridge with the road on a spine and the plain far below |
| mountain | winter | **Hokkaido peak** — snow-laden pines, ice fog, a hot-spring shrine | A rope bridge (grapple anchors) over a frozen gorge |
| city | all | **Tokyo street** — Shinjuku neon, viaduct with a shinkansen; ginkgo in fall, festival lanterns in summer | A crossing under the viaduct as the train passes |
| suburb | all | **Kanto suburb** — hip roofs, paddies (flooded/green/gold/stubble), a level crossing, a konbini | The level crossing with barriers as a wall row |
| coast | all | **Cliffside road** (Izu / Setouchi) — cliff wall left, sea right, pines bent by wind, a torii in the water | The lighthouse point; the sea torii |

### 2.3 Transitions without cuts [proto → next]

Nothing ever pops. Each quantity has an owner and a blend length:

| Quantity | Owner | Blend | Rule |
|---|---|---|---|
| Sky, fog, sun, hemisphere colours | `getTheme(season, night, biome)`; renderer lerps each frame | ~1 s | The palette is a continuous function of `night`; season/biome swaps lerp material colours at `1 − e^(−dt)`. |
| Vegetation mix | Chunk dresser, per chunk, via `seasonBlend(i) ∈ [0,1)` | Last 2 chunks of a season | At `seasonBlend > 0.85`, 50 % of season trees are the *next* season's variant; at the first chunk of the new season, 25 % are the old. Petals on spring trees thin out; momiji reddens from the crown. |
| Ground surface | Ground shader `uBiome`, `uSnow`, `uWet`, plus `uBiomeBlend` **[next]** | 1 chunk | The first chunk of a biome section is a **gate chunk**: the shader crosses flagstone → asphalt (or asphalt → sand) along z with a noise edge; the gate prop (great torii / city gantry / crossing / lighthouse gate) stands at the boundary. |
| Snow cover | `uSnow` = season winter weight | Ramps over 2 chunks either side | Tyre and foot tracks stay dark in the lanes so lane guides never vanish. |
| Particles | `fx.js` modes | 1.5 s cross-fade | Petals → none → leaves → snow; rain and wind ribbons overlay by `dread`. |
| Time of day | `night = 0.5 − 0.5·cos(2π · d / 3600)` | Continuous | Golden hour at the start, deep night at 1.8 km, dawn at 3.6 km. Sun height `46 − 30·night`. Night skies are blue, never black. |
| Wind | Renderer | Continuous | Strength `0.7 / 0.7 / 1.3 / 0.9` by season (spring/summer/fall/winter) `+ 1.2·dread`; direction yaws `±20°` on a 48 s sine. The wind always blows down the road: it is the guiding wind. |

```
// per-chunk dressing (deterministic: rng = mulberry32(mix(seed, index)))
t     = seasonBlend(index)                       // 0..1 through this season
next  = (season + 1) % 4
mixIn = t > 0.85 ? smoothstep(0.85, 1.0, t) * 0.5 : 0
mixOut= (index % SEASON_LEN == 0) ? 0.25 : 0
for each tree slot: variant = rng() < mixIn ? treeOf(next) : rng() < mixOut ? treeOf(season − 1) : treeOf(season)
if index % BIOME_LEN == 0: placeGate(biome); floor.uBiomeBlend = 1   // shader lerps prev→this along z
```

### 2.4 Palette table (sRGB hex, day / golden hour; night variants keep the hue and drop value)

| Province | Season | Sky top | Horizon | Vegetation | Road | Accent light | Visual cue |
|---|---|---|---|---|---|---|---|
| Torii shrine path | spring | `#7d8fd8` | `#ffd0a4` | `#f4b8cf` sakura / `#a6d474` | `#8f8a80` flagstone, `#5c7a45` moss | `#ff5a2e` vermilion torii | Petal drifts, mist on the path |
| Bamboo grove | summer | `#1a45b8` | `#c2e6f7` | `#5faa46` culm, `#2f8038` canopy | `#7c7a70` flagstone | `#fff2c8` dapple | Vertical light shafts, cicadas |
| Fuji ridgeline | fall | `#6e80c2` | `#ffb268` | `#dc562b` momiji, `#d9c17a` susuki | `#8a8378` stone, `#b59a5c` leaf litter | `#ffd49c` low sun | Leaves stream down the road, Fuji fills the sky |
| Hokkaido peak | winter | `#88a6ce` | `#f2eee8` | `#6f7a88` pine, `#f7f8fb` snow | `#e6ebf0` snow, `#3b3f48` tracks | `#ffb56b` onsen lantern | Blue shadows, breath fog, ice fog |
| Tokyo street | spring | `#7d8fd8` | `#f2c9ba` | `#f4b8cf` sakura on the pavement | `#2d2f36` wet asphalt | `#ff3d7f` / `#33d6ff` neon | Neon in puddles, petals on asphalt |
| Tokyo street | summer | `#1a45b8` | `#b8dcf0` | `#3f8a3f` street trees | `#33363c` asphalt | `#ff5a1f` festival chōchin | Heat shimmer, evening shower |
| Tokyo street | fall | `#6e80c2` | `#e9b593` | `#f2c230` ginkgo | `#2d2f36` asphalt | `#ffb347` sodium | Ginkgo on the crossing |
| Tokyo street | winter | `#88a6ce` | `#e0e5ed` | bare `#4c4c58` | `#d8dde4` slush, `#2a2c33` tracks | `#fff1d6` warm windows | Light dusting, warm windows, breath |
| Kanto suburb | spring | `#8fa0dc` | `#f2c9ba` | flooded paddy mirror `#9cc7e0` | `#a9a49a` asphalt, `#e8c33a` centre line | `#ffd9a0` konbini | Paddies reflect the sky |
| Kanto suburb | summer | `#2a5cc8` | `#c2e6f7` | `#4f9f3a` paddy, `#f2c230` sunflowers | `#a9a49a` | `#ffffff` crossing lamp | Cumulus over green fields |
| Kanto suburb | fall | `#7288c4` | `#ffb268` | `#d9a83a` gold paddy, `#d43a3a` spider lilies | `#a19c92` | `#ff4040` crossing lamp | Red lilies along the drains |
| Kanto suburb | winter | `#8ea8cc` | `#f2eee8` | `#b4b19b` stubble, `#f7f8fb` snow | `#dfe3e8` | `#ffe0b0` windows | Snow on tiled roofs |
| Cliffside road | spring | `#7b93d6` | `#ffd0a4` | `#7fb36a` grass on the cliff | `#c9b78e` sand road | `#a9dfe0` sea | Sea torii in haze |
| Cliffside road | summer | `#1a48b8` | `#c2e6f7` | `#3f8a4a` pines | `#c9b78e` | `#2fb8b0` turquoise sea | Hard sun, white breakers |
| Cliffside road | fall | `#6e80c2` | `#ffb268` | `#b89a52` grass | `#bfa980` | `#6088aa` steel sea | Long shadows from the lighthouse |
| Cliffside road | winter | `#88a6ce` | `#e0e5ed` | `#6f7a88` pines, snow on rocks | `#d2d6da` | `#7090aa` grey sea | Spray freezes on the guardrail |

Night for any row: sky top → `#0f1a4c`-`#061038` family, horizon → `#5f4b82`/`#2d5092`, accents unchanged (they are the light sources), road value ×0.35, vegetation ×0.4 with a blue shift.

---

## 3. Visual & Audio Direction

### 3.1 Look rules

| Source | What we take | Rule of thumb |
|---|---|---|
| Shinkai | Banded gradient skies, lens flare along the sun–centre line, god rays, wet-surface reflections, bloom on every light source, a comet with a split tail at night | Every frame has one light source the eye goes to. Night is blue. |
| Ghibli | Painterly noise in gradients, hand-shaped cumulus, three ridge layers in aerial perspective, dense vegetation with soft edges | No flat gradients: everything gets fbm banding at 2–4 % amplitude. Distance is colour, not blur. |
| Ghost of Tsushima | The guiding wind, leaves and petals as a field, weather that arrives across the landscape, hero grass | The wind is a *direction* the player can read; particles never spawn randomly, they flow. |

Materials are vertex-coloured low-poly (merged primitives) with ACES tone mapping at exposure 0.92; albedo authored in 0–1, emissives above 1.0 to bloom.

### 3.2 Shader specs

**Sky dome** (r ≈ 400, back-side, no fog): banded gradient from `skyTop → skyMid → horizon` with 3 % fbm banding; cumulus from 4-octave fbm thresholded by season coverage (spring 0.45, summer 0.6 towering, fall 0.3 cirrus, winter 0.7 flat) with a sun-facing warm edge and `cloudShadow` underside; sun disc with a 12° glow; stars (hash > 0.997, twinkle) and a comet that crosses over 90 s at `night > 0.6`; 3 additive god-ray planes fanning from the sun, rotating at 0.02 rad/s, alpha `(1 − night) · 0.25`; 3–5 lens-flare sprites along sun-screen → centre. ≤ 15 draw calls.

**Wind vertex shader** (grass, flowers, bamboo, banners, noren):

```glsl
float h    = uv.y;                                 // 0 at the root, 1 at the tip
float gust = fbm(vec2(worldPos.z * 0.04 - uTime * 0.9, worldPos.x * 0.07));
float sway = sin(uTime * 2.3 + worldPos.x * 0.5 + worldPos.z * 0.3) * 0.15;
vec3  bend = uWind * (0.35 + 0.65 * gust) * h * h + vec3(sway * h, 0.0, 0.0);
pos       += bend;  pos.y -= length(bend) * 0.25 * h;   // shorten as it bends
vColor     = mix(baseColor, tipColor, h) * (1.0 + 0.15 * gust);
```

**Ground shader** (one plane per chunk, uniforms `uZ0 uTime uBiome uSeason uSnow uNight uWet uLightN uLight[8] uLightCol[8]` + `uBiomeBlend` [next]): biome surface by `uBiome` (flagstone + moss / wet asphalt + dashes + crosswalk / pale asphalt + yellow centre / sand + tyre lines), lane guides at boundaries, painted centre line at x = 0, edge line at |x| = 6.6; puddles = fbm mask × `uWet`, reflecting the light list as vertical streaks toward the viewer (`streak = exp(−|dx| · 6) · exp(−dz · 0.12) · intensity`); snow = `smoothstep(0.3, 0.7, uSnow + noise)` over everything except the tracked lane centres; season specks (petals/leaves) on the verges; verges darken with |x| to meet the instanced grass; output `pow(col, 2.2)` then standard fog.

**Anime grade + bloom** (post, half-res bloom): UnrealBloom threshold 1.0, strength 0.6, radius 0.4; grade LUT-lite: lift shadows toward `#1a2450` by 0.06, saturation 1.1, a 2 % vignette, and a 1.5 % chromatic split on barge/fall. No outlines — silhouettes come from the vertex-colour rim (fresnel emissive at 0.15).

### 3.3 Weather and particle effects (camera-space fields that scroll with `speed`)

| Effect | When | Count (PC / mobile) | Motion |
|---|---|---|---|
| Sakura petals | spring, shrine path & suburb | 600 / 250 | Spiral fall, wind-carried along +z, 0.4 m/s down |
| Falling leaves (momiji/ginkgo) | fall | 500 / 200 | Tumbling quads, 1.2 m/s + wind, colour by province |
| Snow | winter, dense on the peak | 1 200 / 400 | Slow, drifting, 0.7 m/s, depth-sorted alpha |
| Wind ribbons | fall, winter, and `dread > 0.3` | 24 / 12 | Thin white ribbons flowing down the road; they *are* the guiding wind |
| Rain | summer showers (night 0.35–0.65) and `dread > 0.35` | 1 500 / 500 | Streaks, `uWet` rises with them; puddle rings on the ground shader |
| Fireflies | summer nights, shrine & suburb | 80 / 40 | Bobbing, pulsing emissive points |
| Dust motes in sunbeams | afternoon, bamboo grove | 200 / 80 | Slow, in god-ray volumes |
| Lightning | `dread > 0.45`, rate `0.12 + 0.5·dread` /s | flash | Full-frame ambient flash decaying `e^(−12t)`, thunder 0.4–1.2 s later by distance |
| Shock ring | power pickup, shield break, barge | 1 | Ground ring, 0.5 s |
| Spirit trail | always | 1 per runner | Fox-fire ribbon (orange for the fox, jade for the tanuki) |

### 3.4 Lighting

Three lights and a hemisphere, no shadow maps on mobile (blob shadows under the runners), one cascaded shadow map on PC.

| Light | Role | Position / colour |
|---|---|---|
| Sun (key) | Directional, from ahead-right so the road is backlit at golden hour | `(60, 46 − 30·night, 140)`; colour and intensity per season table |
| Fill | Directional, cool, from behind-left | `(−20, 25, −40)`, `#6a80ff` at 0.35 |
| Rim | From the sky colour via hemisphere; fresnel emissive on rigs | Hemisphere sky/ground from theme |
| Flash | Ambient, lightning | `#dde6ff` × flash × 2.5 |

Colour temperature by season (key light): spring 4 800 K peach, summer 6 200 K white, fall 3 600 K amber, winter 7 000 K blue-white; night 9 000 K for the moon-sun in all seasons. Golden hour lingers: `night` maps through a curve that holds the warm palette until 0.35.

### 3.5 Sound design

**Instrumentation.** Shamisen (rhythm, plucked drive at speed), shakuhachi (wind, breath, solitude), taiko (the typhoon, walls, barges), koto (the season theme, arpeggios over coin rivers), with a lo-fi cinematic bed (tape-saturated pads, vinyl crackle at night, sub-bass under the taiko). Tempo tracks speed: 92 BPM at 13 m/s → 132 BPM at 30 m/s, tempo-synced via time-stretch on the bed and re-triggered loops on the plucked layers.

**Adaptive layers** (each a stem, cross-faded ≤ 2 s):

| Layer | Driver | Content |
|---|---|---|
| Bed | always | Lo-fi pad in the season's key (spring D, summer A, fall E minor, winter B minor) |
| Province | biome | Shrine: shakuhachi + wind chimes; bamboo: culm knocks + cicadas; city: shamisen funk + traffic; suburb: koto + crossing bell; coast: koto + gulls + surf |
| Season | season | Spring: koto arpeggios; summer: taiko festival pattern; fall: bowed shamisen; winter: sparse, reverb up 40 % |
| Dread | `dread` | 0–0.3 wind; 0.3–0.6 low taiko heartbeat + rain; 0.6–1 full taiko, bed ducks −6 dB, thunder |
| Speed | `speed` | Adds hi-hat ride and doubled shamisen above 22 m/s |
| Release chunk | `chunk.release` | Everything but bed and koto ducks; one bright motif |
| Night | `night > 0.6` | Crickets, crackle, bed low-passed at 4 kHz |

**SFX list.** Footfalls (stone / asphalt / sand / snow / puddle, 4 variants each, per runner, pitched by body), lane change *whoosh* (panned), jump *huff*, land (surface), slide (cloth-on-stone), stumble (grunt + object rattle), stalk hit (wood/metal/stone by prop), gap fall (drop + splash/clatter) and respawn (bell), coin (koban chime rising a semitone per 5 streak, reset on miss), power pickups (shield: bell + fox-fire hiss; magnet: purse jingle; dash: fūjin gust; daruma: two drum hits; sakura: soft chime), tier-2 (raijin: drum + time-stop tone; tengu: feather fan; kappa: water plate), barge (body thud + surprised bark / tanuki yelp), near-miss (whip + short high ping on that side), wall-row telegraph (taiko hit 0.5 s before + the tanuki's bark), wall-run (pattering + cloth flutter), grapple (rope throw, hook *clink*, creak on the arc, release *snap*), typhoon (layered wind, rain intensity, thunder 3 distances, lightning crack), train pass (shinkansen doppler), level crossing bell, ema found (wood clack + koto motif), death (wind swallows everything, one shakuhachi note), UI (wood block taps).

Accessibility: every telegraph has a visual, an audio and (mobile) a haptic channel; audio is panned to the hazard's side.

---

## 4. Game Engine Implementation Plan

### 4.1 Shipped path: web, Three.js [proto]

The prototype is the production architecture in reduced form: a pure JS sim (`core/`, no Three, no `Math.random`, fixed 60 Hz, replayable) and a renderer that composes modules against the contract in `RENDER_API.md`.

| Concern | Implementation |
|---|---|
| Endless terrain | `ChunkPool` ring buffer (6 ahead, 1 behind); `onRecycle(old, fresh)` moves pooled meshes. Zero allocation after warm-up. |
| Floating origin | The world `root` scrolls by `−distance`; camera and runners stay near scene origin. Sky and horizon are static in scene space. Float precision holds past 10 km. |
| Generation | `generate(seed, index)` on the main thread (< 0.3 ms per chunk). Move to a Web Worker only if tier-2 verbs push it past 1 ms. |
| Object pooling | `MeshPool` free-lists per prop type; `InstancePool` (InstancedMesh with per-instance colour) for coins, grass (~6 000 blades), flowers, cedars, buildings, boulders. |
| Shader transitions | Global uniforms (`uNight`, `uSnow`, `uWet`, `uWind`) set once per frame; per-chunk uniforms (`uZ0`, `uBiome`, `uSeason`, light list) set on attach. Theme colours lerped per frame. |
| LOD | Two distance bands: full props within 3 chunks, impostor quads (pre-rendered sprites) for cedars/buildings beyond; scenery outside |x| ≥ 40 m is a painted ridge layer. |
| Post | Bloom half-res + grade; `?bloom=0` fallback. |

### 4.2 Recommended for stores: Unity (URP, C#)

The mapping is 1:1 because the sim is already engine-free.

| Web concept | Unity |
|---|---|
| `core/world.js` fixed tick | Plain C# `World` class stepped from `FixedUpdate` at 60 Hz; no MonoBehaviours in the sim; `mulberry32` ported verbatim (never `UnityEngine.Random`) |
| `generate(seed, index)` | A Burst-compiled `IJob` per chunk writing `NativeArray<Cell>`; scheduled 2 chunks before need, completed on attach. Determinism is preserved because the job is pure integer math. |
| Chunk pool | `ObjectPool<ChunkView>`; each view holds pooled prop instances and an instanced batch |
| Floating origin | `TrackRoot` transform moves by `−distance`; rebase the root to 0 every 2 km and subtract from all children (one frame, no visible seam because the camera is at origin) |
| Instancing | `Graphics.RenderMeshInstanced` / `BatchRendererGroup` for coins, grass, trees, buildings; GPU instancing enabled on shared materials |
| Object pooling | `ObjectPool<T>` per prop type warmed to the max cells per 8 live chunks (≈ 120 props, 400 coins) |
| Shader transitions | `Shader.SetGlobalFloat("_Night"/"_Snow"/"_Wet")`, `Shader.SetGlobalVector("_Wind")`; per-chunk `MaterialPropertyBlock` for `_Z0`, `_Biome`, light arrays; Shader Graph for ground/sky/wind |
| LOD | `LODGroup` on hero props (2 levels + cull), impostors via a baked octahedral atlas for cedars |
| Particles | VFX Graph, GPU-simulated fields for petals/leaves/snow/rain (counts in §3.3), Shuriken for one-shot rings |
| Post | URP Volume: Bloom (threshold 1.0, intensity 0.6), colour grading LUT, vignette; ACES |
| Netcode | Netcode for GameObjects with `NetworkVariable<float>` for the shared margin; events as RPCs stamped with the shared tick |

### 4.3 Alternative: Unreal 5

| Web concept | Unreal |
|---|---|
| Sim | A `UObject`-free C++ `FWorld` stepped from a fixed-tick manager; same `mulberry32` |
| Chunk generation | PCG framework for dressing; hazard generation stays in C++ (PCG is not deterministic across platforms) |
| Floating origin | World origin rebinding (`SetNewWorldOrigin`) every 2 km |
| Instancing | Hierarchical Instanced Static Mesh components per prop type per chunk; Nanite off for mobile |
| Shader transitions | Material Parameter Collections for `Night/Snow/Wet/Wind`; Dynamic Material Instances per chunk for `Z0/Biome` |
| Particles | Niagara GPU emitters with the wind vector as a user parameter |
| Post | Post Process Volume: bloom, LUT, vignette; Lumen off, baked skylight |

### 4.4 Performance budgets

| Budget | Mobile (2019 phone, 60 fps) | PC / console (120 fps target, 4K capable) |
|---|---|---|
| Draw calls | ≤ 150 | ≤ 400 |
| Triangles on screen | ≤ 300 k | ≤ 1.5 M |
| Instanced grass blades | 6 000 | 24 000 |
| Particles (all fields) | ≤ 1 500 | ≤ 6 000 |
| Lights | 1 directional + hemisphere + ambient, no shadow maps, 8 ground-shader lights per chunk | + 1 cascaded shadow map (2 cascades), 16 ground lights |
| Post | Bloom at half-res, no AA (MSAA 2× if free) | Bloom full-res, TAA/SMAA |
| Sim | ≤ 0.5 ms per tick | ≤ 0.5 ms |
| Chunk attach spike | ≤ 2 ms | ≤ 1 ms |
| Memory | ≤ 350 MB | ≤ 1.5 GB |
| Load to first run | ≤ 5 s over 4G (web: ≤ 3 MB initial, textures streamed) | ≤ 3 s |

### 4.5 Milestone plan

| Milestone | Weeks | Deliverable | Exit criteria |
|---|---|---|---|
| **M0 — Vertical slice (current)** | done | Six-lane sim, barge, companion, four biomes, seasons, sky, ground, particles | 120 k-chunk solvability test green; 60 fps on a 2019 phone with `?bloom=0` |
| **M1 — Provinces & transitions** | 4 | Seven province dressings, gate chunks, `uBiomeBlend`, vegetation mix, palette table implemented | No visible pop at any boundary in a 10 km soak; theme parity with §2.4 |
| **M2 — Tier-2 movement** | 4 | Wall-run, grapple, lantern-hop rows, gamepad, camera spec | Solvability test unchanged and green; wall exits and anchor landings fuzz-tested over 2 000 seeds |
| **M3 — Tier-2 powers, audio** | 3 | Raijin, Tengu, Kappa; adaptive music stems; full SFX list | Every telegraph has 3 channels; dread mix audited at 0 / 0.5 / 1 |
| **M4 — Meta & daily** | 3 | Ema Wall, omikuji, seed of the day, replay validation, cosmetics | Server replay matches client within 1 % on 1 000 runs |
| **M5 — Mobile wrap** | 3 | Capacitor builds, haptics, touch halves, budgets met | 60 fps median on the reference phone; thermal soak 20 min |
| **M6 — Unity port (store path)** | 8 | Sim port with a byte-identical replay test against the JS sim; URP renderer at parity | Same seed → same summary on both engines; PC 120 fps at 1440p |
| **Soft launch** | 2 | Two regions, KPI: D1 40 %, D7 18 %, 8 runs/session | Tuning envelope (§1.8) locked from telemetry |

---

## Appendix — one-page pitch

**KITSUNE** is an endless runner about a fox spirit and a tanuki running the old road from the mountain shrines to the sea while a typhoon follows. The road turns through Japan's provinces and seasons without a single cut — sakura to summer rain to momiji to snow every two kilometres — and the wind shows the way. Two runners share one six-lane road; they can cross over and barge each other, and in single-player the tanuki runs beside you with its mistakes forgiven. Every hazard is provably fair; every mistake costs distance from the storm, never a life. Read the road, follow the wind, don't let the sky close.
