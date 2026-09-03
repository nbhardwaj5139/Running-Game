# KITSUNE · 狐 — an endless run through Japan's seasons

> A fox spirit and a tanuki run the old road from the mountain shrines through the city, the suburbs and the coast, as spring turns to summer, autumn and winter. A typhoon follows. Keep the pair ahead of it.

**Play it:** `npm install && npm run dev` → http://localhost:8080 — pick **1 Player** (you are the fox; the tanuki spirit runs beside you) or **2 Players** (WASD tanuki, arrows fox, one keyboard). The two can cross into each other's half of the road and **barge** each other.

Docs: [`docs/KITSUNE_GDD.md`](docs/KITSUNE_GDD.md) (the current design), [`docs/RENDER_API.md`](docs/RENDER_API.md) (renderer module contract), [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) + [`docs/TECHNICAL_BLUEPRINT.md`](docs/TECHNICAL_BLUEPRINT.md) (the original VITREOUS concept and multiplayer designs this grew from).

## What's in the prototype
- **Sim** (`prototype/src/core/`): one six-lane road made of two solvable home tracks; kaiju encounters before every season change (Daidarabotchi, Umibōzu, Gashadokuro, Yuki-Oni throw boulders, boats, bones and ice onto the road, plus full-width waves to jump); obstacles stalk / arch / drusen / gap / wide / roller; torii walls; powers (Kitsune Shield, Tanuki Magnet, Wind Kami Dash, Daruma ×2, Sakura Heal); a shared typhoon margin; falls respawn; runner-vs-runner barging; an autopilot companion; deterministic replay.
- **Render** (`prototype/src/render/`): 65 procedural Japanese obstacle variants, fox and tanuki rigs, scenery for mountain / city / suburb / coast across four seasons, a wet-asphalt/flagstone/sand ground shader with puddle reflections and snow, a Shinkai-style sky (cumulus, comet, god rays, lens flare), instanced wind-swayed grass and flowers, seasonal particles (petals, tumbling leaves, snow, fireflies, rain, wind ribbons), bloom + anime grade.
- **Tests** (`tests/`): 240,000-track solvability sweep, replay determinism, powers, barging, autopilot.

`?seed=NAME` fixes the road (default: Seed of the Day), `?mode=1|2` skips the start screen, `?bloom=0` disables post-processing, `?reduced=1` for reduced motion.

`server/` is the Shared Nerve multiplayer server from the earlier single-runner build; it is not wired into the two-runner prototype.

---

## Run it

```bash
npm install          # installs socket.io for the server (three.js loads from a CDN)
npm run dev          # http://localhost:8080  — game + multiplayer server
npm test             # node --test
```

- **Solo, seed of the day:** `http://localhost:8080/`
- **Solo, fixed seed:** `http://localhost:8080/?seed=sleeper`
- **Shared Nerve:** open `http://localhost:8080/?room=NAME` in two browsers (or send the link). The room name *is* the seed, so everyone runs the same eye.
- `?reduced=1` turns tremors into hard cuts with a longer telegraph; `?bloom=0` disables post-processing on weak GPUs.

Without Node you can serve `prototype/` with any static server (`npm run serve` uses Python's) — solo mode works, multiplayer needs `npm run dev`.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Lane | `←` `→` / `A` `D` | swipe left / right |
| Jump (hold for height) | `↑` / `W` / `Space` | swipe up or tap |
| Slide (fast-fall in air) | `↓` / `S` | swipe down |
| Spend Ki → tremor | `Q` (left) / `E` (right) | tap top-left / top-right |
| Restart | `R` | tap after death |

## How the pieces fit

```
prototype/src/core/     pure simulation — no Three.js, no Math.random; runs in browser, tests and server
  rng.js                mulberry32 + seed mixing
  chunks.js             generate(seed, index) → Chunk, solvability grammar, ChunkPool ring buffer
  player.js             buffered inputs, coyote time, variable jump, eased lanes, momentum
  world.js              Blink, saccades (the 3-lane window over 5 lanes), collisions, scoring, replay()
  protocol.js           Shared Nerve wire messages
prototype/src/render/   Three.js: renderer (pools, instancing, bloom, camera), props (merged vertex-coloured geometry, the fox rig),
                        ground (stone path / wet asphalt shader with neon reflections), sky (dome, Fuji, ridges, tower), fx (petals, fireflies, rain, trail, train)
prototype/src/net/      Socket.io client: tick sync, 10 Hz hints, scheduled saccades
server/server.js        rooms, shared Nerve, saccade ordering, blink surge, replay validation
```

The one idea everything hangs on: **a chunk is a pure function of `(seed, index)`.** Clients never exchange geometry — only 8-byte events and 10 Hz position hints — which is what lets a saccade fired by one player twitch the eye for everyone at 200 ms ping.
