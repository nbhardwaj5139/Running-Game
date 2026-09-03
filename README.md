# KITSUNE · 狐 — an endless run from the mountain shrines into Tokyo

> A fox spirit runs a stone shrine path through cedar and sakura, down into a neon street at dusk. A typhoon follows. Tremors shift the road under your feet.

A 3D endless runner that modernises the Temple Run loop with one mechanical twist — **the world moves, not you** — and a multiplayer mode where rivals share the same road and the same *Ki* that makes it tremble.

The design documents were written for the original concept, **VITREOUS** (running inside the eye of a sleeping colossus); the playable prototype is its **Japan art build**. The simulation is identical — the docs' *saccade* is the build's *tremor*, the *Blink* is the *typhoon*, *Nerve* is *Ki*, *photons* are *coins*:

| Sim cell | Mountain shrine path (chunks 0–9, 20–29 …) | Tokyo street (chunks 10–19, 30–39 …) | Escape |
|---|---|---|---|
| `stalk` | stone lantern (石灯籠) | vending machine | change lane |
| `arch` | small torii | noren shop curtain | slide |
| `drusen` | mossy boulder | striped construction barrier | jump |
| `gap` | broken flagstones | open manhole strip | jump |
| `photon` / `lumen` | koban coins / hitodama wisp | koban coins / hitodama wisp | collect |

Set-dressing per biome: instanced cedars and sakura, roadside lanterns and strings of chōchin, ground mist and fireflies; instanced buildings with lit windows, kanji neon signs (ラーメン, 寿司, 居酒屋…) whose light reflects in puddles on wet asphalt, street lamps, an elevated viaduct with a passing shinkansen. Mount Fuji, layered ridges, and a Tokyo-Tower silhouette sit on the horizon; the sun sets over the first 1.5 km and the sky goes to stars. Bloom for anything that glows; sakura petals; typhoon rain and lightning as the storm closes in.

| | |
|---|---|
| **Design** | [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — three original settings (Vitreous, The Long Fall, Canticle), the Blink, saccades, five multiplayer designs, core loop, progression, monetization |
| **Blueprint** | [`docs/TECHNICAL_BLUEPRINT.md`](docs/TECHNICAL_BLUEPRINT.md) — stack choice, chunk-pooled procgen with a solvability grammar, event-based netcode with a shared tick clock, movement pseudocode |
| **Prototype** | [`prototype/`](prototype) — zero-build Three.js implementation of the blueprint (single-player + Shared Nerve) |
| **Server** | [`server/`](server) — Socket.io room server: tick clock, shared Nerve, saccade scheduling, replay validation |
| **Tests** | [`tests/`](tests) — determinism, a 120 000-chunk solvability sweep, pool recycling, movement, replay |

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
