# VITREOUS

> *Something enormous is asleep. You live in its eye. Don't let it blink.*

A 3D endless runner that modernises the Temple Run loop with one mechanical twist — **the world moves, not you** — and a multiplayer mode where rivals share the same eye and the same nerve that makes it twitch.

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
- `?reduced=1` turns saccades into hard cuts with a longer telegraph.

Without Node you can serve `prototype/` with any static server (`npm run serve` uses Python's) — solo mode works, multiplayer needs `npm run dev`.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Lane | `←` `→` / `A` `D` | swipe left / right |
| Jump (hold for height) | `↑` / `W` / `Space` | swipe up or tap |
| Slide (fast-fall in air) | `↓` / `S` | swipe down |
| Spend Nerve → saccade | `Q` (left) / `E` (right) | tap top-left / top-right |
| Restart | `R` | tap after death |

## How the pieces fit

```
prototype/src/core/     pure simulation — no Three.js, no Math.random; runs in browser, tests and server
  rng.js                mulberry32 + seed mixing
  chunks.js             generate(seed, index) → Chunk, solvability grammar, ChunkPool ring buffer
  player.js             buffered inputs, coyote time, variable jump, eased lanes, momentum
  world.js              Blink, saccades (the 3-lane window over 5 lanes), collisions, scoring, replay()
  protocol.js           Shared Nerve wire messages
prototype/src/render/   Three.js: pooled meshes, retina floor shader, the Blink, saccade tween
prototype/src/net/      Socket.io client: tick sync, 10 Hz hints, scheduled saccades
server/server.js        rooms, shared Nerve, saccade ordering, blink surge, replay validation
```

The one idea everything hangs on: **a chunk is a pure function of `(seed, index)`.** Clients never exchange geometry — only 8-byte events and 10 Hz position hints — which is what lets a saccade fired by one player twitch the eye for everyone at 200 ms ping.
