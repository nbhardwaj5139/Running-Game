# VITREOUS — Technical Blueprint

Companion to [`GAME_DESIGN.md`](./GAME_DESIGN.md). Everything here is implemented (in reduced form) in [`../prototype`](../prototype) and [`../server`](../server); file references point at that code.

## 0. Stack recommendation

### Primary: Web — Three.js + TypeScript + Vite, Node server

| Layer | Choice | Notes |
|---|---|---|
| Rendering | **Three.js** (WebGL2 now, WebGPU renderer when stable) | Instanced meshes for obstacles, one custom shader for the retina floor, post-FX limited to bloom + vignette. 60 fps on a 2019 phone is the budget. |
| Language / build | **TypeScript + Vite** | The prototype is plain ES modules so it runs without a build step; port to TS is mechanical. |
| Sim | **Pure JS, no engine dependency** (`prototype/src/core/*`) | The simulation never imports Three. It runs in the browser, in Node tests, and on the server for validation, byte-for-byte identical. |
| Netcode | **Socket.io** (prototype) → **Colyseus** (production) | Colyseus gives rooms, state patching, and reconnection out of the box. The protocol in §2 is transport-agnostic. |
| Persistence | Postgres (players, seeds, run event logs), Redis (daily leaderboards, room presence) | A run's replay is `seed + eventLog` (~2 KB). |
| Mobile | Capacitor wrappers; native haptics via plugin | Store presence without a second codebase. |

**Why web first:** the multiplayer design (§2 of the GDD) lives or dies on *"send a link, play in 5 seconds."* A URL with a seed and a room ID is the entire onboarding.

### Fallback: Unity (C#) + Netcode for GameObjects

If mobile-store-first is mandated, the same architecture maps 1:1:

| Web concept | Unity equivalent |
|---|---|
| `core/world.js` fixed-tick sim | `FixedUpdate` at 60 Hz on a plain C# `World` class (no MonoBehaviours in the sim) |
| Chunk pool + instanced meshes | `ObjectPool<T>` + `Graphics.RenderMeshInstanced` / GPU instancing on a shared material |
| Seeded generator | Same `mulberry32` port; **do not** use `UnityEngine.Random` (not stable across platforms) |
| Socket.io events | NGO `ServerRpc`/`ClientRpc` with `NetworkVariable<int>` for shared Nerve; or Photon Fusion in shared mode |
| Saccade world-root offset | Move a `TrackRoot` transform; camera and player stay near origin |

Godot 4 (GDScript/C#) is a fine third option; its high-level multiplayer API is adequate for this event-based protocol, but web export performance for 3D is still behind Three.js.

---

## 1. Procedural generation — chunk-based pooling

### 1.1 Coordinate model

- The track is a straight line along **+Z**. Curves are *visual* (the camera and floor shader bend; the sim is straight). This keeps the sim trivial and lets rivals be drawn on the same track.
- **5 world lanes** (`x = (lane − 2) · 2.2 m`, lane ∈ 0..4). The runner sees a **3-lane window** `[w, w+2]`, `w ∈ {0,1,2}`. A saccade changes `w`.
- The runner's *view lane* `v ∈ {0,1,2}`; their *world lane* is `v + w`. Collision is evaluated in world lanes.
- Rendering: the **world root** is translated by `x = −(w − 1) · laneWidth` so the window centre is always screen-centre. The runner mesh sits at `x = (v − 1) · laneWidth`. A saccade is a 250 ms eased tween of the root's x. The runner never moves; the world does. (`render/renderer.js → syncWindow()`)

### 1.2 Chunk as data

A chunk is **data, never a scene**:

```ts
interface Chunk {
  index: number;        // monotonic chunk number since run start
  z0: number;           // world z of chunk start = index * CHUNK_LEN
  length: number;       // 36 m in the prototype
  difficulty: number;   // 0..1, from the breathing curve
  cells: Cell[];        // hazards & pickups
  rows: RowMask[];      // per-beat safety masks (for validation & AI)
}
interface Cell { z: number; lane: number; type: 'arch'|'stalk'|'drusen'|'gap'|'photon'|'lumen'|'channel'; hi?: boolean; }
```

The renderer turns cells into pooled meshes; the sim tests the runner against cells. Neither side owns geometry.

### 1.3 Generator: `generate(seed, index) → Chunk` *(pure)*

```
rng   = mulberry32(hash(seed, index))            // no shared state between chunks
diff  = breathing(index)                          // 0..1
rows  = []
reach = allLanes()                                // per-window sets of lanes the runner can be in
for beat in 0 .. CHUNK_LEN / BEAT_LEN:            // BEAT_LEN = 6 m at any speed
    if beat is last: rows.push(EMPTY); continue   // "breath beat": chunks never depend on each other
    hazardCount = sampleCount(rng, diff)          // 0..2 (rarely 3 at diff>0.8)
    repeat:
        mask = placeHazards(rng, hazardCount)     // lane → type | none
    until (next = stepReach(mask, reach)) != null // see 1.4
    rows.push(mask); reach = next
    pickups(rng, mask, diff)                      // photon lines in safe lanes, over-jump arcs on drusen
```

The **breath beat** (the last row of every chunk is always clear) is what keeps `generate` a pure function of `(seed, index)`: every chunk starts with every lane reachable, so no seam state is carried between chunks and a client — or the server — can build chunk 41 without chunk 40.

**Breathing difficulty curve.** Rather than `diff = f(distance)` monotonic, use a *base ramp* modulated by a tension/release wave with a seeded period so no two eyes feel the same:

```
base   = clamp(0.15 + 0.85 * (1 - exp(-index / 40)), 0, 1)       // ramps to ~1 by chunk 120
phase  = (index % period) / period,  period = 5..7 chosen from seed
wave   = phase < 0.7 ? smoothstep(0, 0.7, phase) : 1 - smoothstep(0.7, 1, phase)   // 70 % tension, 30 % release
diff   = base * (0.55 + 0.45 * wave)
```

Release chunks (`wave < 0.2`) get *photon rivers* and *tear channels* instead of hazards. This is the "dread → relief" loop from GDD §4.1.

**Difficulty knobs the curve drives** (all in `core/chunks.js → TUNING`):

| knob | at diff 0 | at diff 1 |
|---|---|---|
| hazards per beat | 0–1 | 1–2 (3 @ ≥0.85) |
| blocking share (`stalk`, `gap`) | 20 % | 55 % |
| double-beat combos (arch then drusen next beat, same lane) | never | 30 % |
| clot every N chunks | never | every 6 |

### 1.4 Solvability grammar

Because the window can slide *during* a chunk, a chunk must be solvable **from every window position**. Rules enforced by `solvable()`:

1. **Per row, per window:** for each `w ∈ {0,1,2}`, at least one lane in `[w, w+2]` is *passable* (not `stalk`, not `gap` — those are the only lethal-without-lane-change cells; `arch`/`drusen` are passable with an action).
2. **Reachability:** the generator carries a *reach set* per window — the lanes the runner can actually occupy after the previous row (not merely the lanes that were passable; a lane can be passable and unreachable). A row is accepted only if, for each window, some passable lane `L` has a reachable `L'` in the previous row with `|L − L'| ≤ 1`. (One lane change per beat is always achievable at any speed because `BEAT_LEN / maxSpeed = 0.25 s > laneChangeTime = 0.18 s`.)
3. **No forced double-action:** a passable lane never has `arch` and `drusen` in consecutive rows *and* both neighbours blocked (you can't slide and jump in 0.25 s).
4. **Global cap:** never more than 2 blocking cells in any row of 5 (guarantees rule 1 trivially and keeps the eye readable). The one exception is the **macular clot**: a full wall whose open lane is always 1–3 and whose neighbours are slide-able arches, preceded by a clear telegraph beat — so every window still has an escape.

`tests/chunks.test.js` runs an independent DP over 2 000 seeds × 60 chunks × 3 windows (120 000 chunks) and asserts a path exists through every one. **This is the single most valuable test in the project** — it is what makes "fair" a property and not a hope.

### 1.5 Chunk pool (ring buffer)

```
ChunkPool(seed, AHEAD=6, BEHIND=1)
  live: Chunk[]           // ring of AHEAD + BEHIND + 1 slots, ordered by index
  update(playerZ):
    while live.first.z0 + live.first.length < playerZ - BEHIND*CHUNK_LEN:
        recycled = live.shift()
        next     = generate(seed, live.last.index + 1)    // pure, no state
        live.push(next)
        onRecycle(recycled, next)                          // renderer swaps meshes
```

On the render side (`render/renderer.js → ChunkView`), each obstacle type has a **free-list of meshes** (or one `InstancedMesh` per type at scale). `onRecycle` returns the old chunk's meshes to their lists and pulls meshes for the new chunk's cells. No allocation after warm-up; no GC spikes.

**Float precision:** because the sim is straight along Z and a run can exceed 10 km, keep the *camera* near the origin: the renderer subtracts `player.z` from every object's z each frame (or moves the world root by `−player.z`). The prototype does the latter.

### 1.6 Determinism requirements (for multiplayer & replays)

- `mulberry32` only; **no `Math.random`** in `core/`.
- Fixed tick `dt = 1/60`; the render loop accumulates real time and steps the sim in whole ticks.
- Chunk generation depends only on `(seed, index)`; saccades and pickups mutate *runtime* state, never the chunk.
- Any event that changes the sim (input, saccade) is stamped with a tick number. A run is fully described by `seed + events[]`.

---

## 2. Multiplayer networking

### 2.1 Topology

```
   browser A ──┐                                ┌── browser C
   browser B ──┼── Socket.io / Colyseus room ────┤   (spectator / Dreamer)
               │   authoritative for:           │
               │   • tick clock                 │
               │   • Nerve meter                │
               │   • event ordering & scheduling│
               └────────────────────────────────┘
```

The server owns **time, the shared resource, and event order**. It does *not* own player positions — those are client-simulated and untrusted until post-run validation (§2.5).

### 2.2 Shared tick clock

- On join the server sends `{ seed, serverTick, tickRate: 60 }`; the client estimates offset using 3 ping samples (NTP-style) and re-samples every 5 s.
- Every client runs its own sim on its own local tick, but *schedules* incoming events on **server ticks** converted to local.
- **Events are always scheduled in the future**: a saccade requested at server tick `T` is broadcast with `applyTick = T + 18` (300 ms). Anyone with RTT < 300 ms applies it at the exact same sim moment. Anyone slower gets it late — and receives the *telegraph* late — which is the fair penalty.

### 2.3 Protocol (`prototype/src/net/protocol.js`)

| Message | Dir | Payload | Rate |
|---|---|---|---|
| `join` | C→S | `{ room, name }` | once |
| `welcome` | S→C | `{ id, seed, serverTick, players[] }` | once |
| `hint` | C→S→C | `{ id, z, lane, y, action }` | 10 Hz, unreliable-ok |
| `nerve.charge` | C→S | `{ amount, reason }` | on event (rate-limited: ≤ 20/s, ≤ 30/msg) |
| `nerve` | S→C | `{ value }` | on change |
| `saccade.request` | C→S | `{ dir: -1 \| 1 }` | on input |
| `saccade` | S→C | `{ dir, applyTick, by }` | on accept |
| `blink.surge` | S→C | `{ target, meters }` | with each saccade |
| `death` | C→S→C | `{ id, z, tick }` | once |
| `run.end` | C→S | `{ eventLog }` | once (for validation) |

`hint` is the *only* high-rate message and it's tiny (5 numbers). At 4 players × 10 Hz that's ~2 KB/s per client. Position hints drive the **afterimage** rendering with interpolation (render 150 ms in the past between the two most recent hints; extrapolate at most 100 ms beyond).

### 2.4 Latency handling

| Problem | Handling |
|---|---|
| Saccade arrives late | It was scheduled 300 ms ahead; up to ~250 ms RTT it applies on time. Beyond that the client applies it *immediately* with a shortened telegraph (never < 120 ms) and logs the deviation; the run is flagged for validation. |
| Two players request a saccade in the same tick | Server processes in arrival order; the second fails with `nerve` insufficient (or succeeds if the meter allows — two saccades can stack, which is legal and dramatic). |
| Nerve race (client shows 40, server says 38) | Client shows a *predicted* meter; a rejected `saccade.request` snaps the UI back with a "not yet" pulse. Never predict the saccade itself. |
| Rival afterimage jitter | Hints are interpolated; lane and action are discrete so they snap; only `z` and `y` are lerped. |
| Disconnect | Client keeps running solo on the same seed; a reconnect within 20 s re-syncs the tick and Nerve. Saccades missed while offline are *not* replayed (the eye twitched without you). |
| Cheating (fake `hint`, fake `nerve.charge`) | Rate limits at the server; hints affect only cosmetics; the run's outcome is revalidated by replay (§2.5). |

### 2.5 Server-side validation by replay

Because `core/` is pure JS, the Node server can run it: given `seed + eventLog` (inputs with tick stamps + received saccades), the server re-simulates and checks the reported distance/score. A ±1 % tolerance covers float differences across engines (there are none in Node vs. V8 in-browser, but keep the tolerance for a future Unity client). Leaderboard entries are *pending* until validated (< 50 ms per run).

### 2.6 Obstacle spawning across the network

There is **none** — this is the key simplification. The track is `generate(seed, index)` everywhere. For the *Dreamer* mode (asymmetric), the Dreamer's placements are events: `{ type: 'place', chunkIndex, lane, beat, kind, applyTick }`, scheduled ≥ 2 chunks ahead of the leading runner; clients apply them as *overlays* on the generated chunk before it becomes visible. Solvability rule 1.4 is re-checked on the server before accepting a placement.

---

## 3. Player movement system

Fixed 60 Hz. All constants live in `core/player.js → P`.

```
CONSTANTS
  LANE_W        = 2.2       LANE_T       = 0.18 s   (lane change duration)
  GRAVITY       = -32       JUMP_V       = 11.5     (hold ≤ 0.18 s for full height; release early → vy *= 0.55)
  SLIDE_T       = 0.55 s    SLIDE_H      = 0.45     (hitbox height while sliding; standing = 1.6)
  BUFFER_T      = 0.15 s    COYOTE_T     = 0.08 s
  STUMBLE_T     = 1.2 s     STUMBLE_MULT = 0.7
  SPEED(d)      = min(24, 11 + 5 * log2(1 + d/400))

STATE
  viewLane ∈ {0,1,2}, laneFrom, laneT (0..1 progress of a lane change)
  y, vy, grounded, jumpHeld, jumpHeldT
  action ∈ {run, jump, slide}, slideT
  stumbleT, alive
  buffered: { jump?: tick, slide?: tick, lane?: (-1|1, tick) }

INPUT(evt, tick)             // from keyboard, touch swipe, or replay log
  buffered[evt.kind] = { ...evt, tick }   // newest wins; consumed within BUFFER_T

TICK(dt, world)
  speed = SPEED(distance) * (stumbleT > 0 ? STUMBLE_MULT : 1) * (channel ? 1.15 : 1)
  distance += speed * dt

  --- lane change (view lanes; the world root handles saccades) ---
  if buffered.lane and (laneT >= 1 or laneT > 0.6):      // allow chaining late in a change
     target = clamp(viewLane + dir, 0, 2)
     if target != viewLane: laneFrom = currentX(); viewLane = target; laneT = 0
     consume(buffered.lane)
  laneT = min(1, laneT + dt / LANE_T)
  x = lerp(laneFrom, laneX(viewLane), easeOutCubic(laneT))

  --- jump (variable height, buffering, coyote) ---
  canJump = grounded or (airTime < COYOTE_T)
  if buffered.jump and canJump and action != slide:
     vy = JUMP_V; grounded = false; action = jump; jumpHeld = true; jumpHeldT = 0; consume(buffered.jump)
  if action == jump and jumpHeld:
     jumpHeldT += dt
     if (!input.jumpDown or jumpHeldT > 0.18) and vy > 0: vy *= 0.55; jumpHeld = false   // short hop
  vy += GRAVITY * dt;  y = max(0, y + vy * dt)
  if y == 0 and !grounded: grounded = true; action = run

  --- slide (cancels jump if pressed in air: fast-fall) ---
  if buffered.slide:
     if !grounded: vy = -18                             // fast-fall then slide on landing
     else: action = slide; slideT = SLIDE_T
     consume(buffered.slide)
  if action == slide: slideT -= dt; if slideT <= 0: action = run

  --- hitbox ---
  height = action == slide ? SLIDE_H : 1.6
  worldLane = viewLane + world.window        // integer lane for collision, see world.js
  stumbleT = max(0, stumbleT - dt)
```

**Collision resolution** (`core/world.js → resolveCell`), evaluated once per cell as the runner's z crosses `cell.z` (cells have a 1.2 m depth; gaps 3 m):

| cell | pass condition | else |
|---|---|---|
| `arch` | `action == slide` | stumble(+8 m Blink) |
| `drusen` | `y > 0.5` | stumble(+8) |
| `stalk` | not in that lane (evaluated on lane *during* change using `x` proximity ≤ 0.9 m) | stumble(+14), knock back to previous lane |
| `gap` | `y > 0.25` at cell centre | **death** (fall) |
| `photon` | same lane, `hi ? y > 0.8 : true` | — |
| `lumen` | same lane | Nerve +25 |
| `channel` | same lane, grounded | speed ×1.15 for its length, score ×2 |

**Near-miss** (score & Nerve): a `stalk` or `gap` in an adjacent world lane crossed while *not* stumbling → `+5 Nerve, +25 score`, with a screen-edge flash on that side. This rewards running *close* to danger, which is what makes the shared window shifting feel like a duel.

**Momentum feel.** Speed only depends on distance, but *perceived* momentum comes from: camera FOV widening with speed (60 → 74°), the floor shader's scroll rate, lane-change duration staying constant (so lane changes feel *sharper* at speed), and the stumble multiplier — the only thing that ever slows you down, which is why it hurts.

---

## 4. Rendering notes (prototype → production)

- **Retina floor:** one plane per chunk with a procedural shader: animated capillary lines (fbm-thresholded), a subtle photoreceptor dot grid, lane guides that pulse at the beat. Gaps are rendered as a second dark quad above the floor so the shader needn't know about them.
- **Obstacles:** stalk = capsule (pale, subsurface-ish via fresnel emissive), arch = half-torus, drusen = squashed sphere with waxy yellow, clot = a wall of instanced spheres with one gap. All from a **free-list per type**; production swaps to `InstancedMesh` and updates matrices on recycle.
- **The Blink:** a full-width dark plane behind the camera, with a soft-edged alpha gradient and a slow "lash" noise on its top edge. Its distance behind the runner is `world.blink`. A bloom-heavy iris flare on the horizon is the saccade telegraph, offset toward the direction of the shift.
- **Saccade:** tween `worldRoot.position.x` over 250 ms with `easeInOutQuad`, plus a 4° camera roll opposite the shift and a chromatic-aberration spike. Reduced-motion mode replaces the tween with a cut after a 500 ms telegraph.
- **Budget:** ≤ 150 draw calls, ≤ 300k triangles, one shadow-less directional light + hemisphere; bloom at half-res.

---

## 5. Repository layout

```
docs/                   GDD and this blueprint
prototype/              zero-build Three.js prototype (open index.html via any static server)
  src/core/             pure sim: rng, chunks (generator + pool), player, world, protocol
  src/render/           Three.js renderer, materials, HUD glue
  src/net/              Socket.io client (Shared Nerve)
  src/main.js           bootstrap, input, game loop
server/                 Socket.io room server (tick clock, shared Nerve, saccade scheduling)
tests/                  node --test: determinism, solvability DP, pool recycling, movement
```
