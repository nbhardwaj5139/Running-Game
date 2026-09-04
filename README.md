# KITSUNE · 狐 — an endless run through Japan's seasons

> A fox spirit and a tanuki run the old road from the mountain shrines through the city, the suburbs and the coast, as spring turns to summer, autumn and winter. A typhoon follows. Keep the pair ahead of it.

**Play it:** `npm install && npm run dev` → http://localhost:8080 — pick **1 Player** (you are the fox; the tanuki spirit runs beside you) or **2 Players** (WASD tanuki, arrows fox, one keyboard). The two can cross into each other's half of the road and **barge** each other.

Docs: [`docs/KITSUNE_GDD.md`](docs/KITSUNE_GDD.md) (the current design), [`docs/SPLINE_TRACK_ARCHITECTURE.md`](docs/SPLINE_TRACK_ARCHITECTURE.md) (curved/elevated/split track architecture with Unity C# scripts), [`docs/RENDER_API.md`](docs/RENDER_API.md) (renderer module contract), [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) + [`docs/TECHNICAL_BLUEPRINT.md`](docs/TECHNICAL_BLUEPRINT.md) (the original VITREOUS concept and multiplayer designs this grew from).

## What's in the prototype
- **Sim** (`prototype/src/core/`): one six-lane road made of two solvable home tracks; kaiju encounters before every season change (Daidarabotchi, Umibōzu, Gashadokuro, Yuki-Oni throw boulders, boats, bones and ice onto the road, plus full-width waves to jump); obstacles stalk / arch / drusen / gap / wide / roller; torii walls; powers (Kitsune Shield, Tanuki Magnet, Wind Kami Dash, Daruma ×2, Sakura Heal); a shared typhoon margin; falls respawn; runner-vs-runner barging; an autopilot companion; deterministic replay.
- **The journey**: Kyoto (shrine stairs through a torii tunnel to a hilltop shrine) → Osaka → Nara (deer that roam and bow) → Shōnan → Hakone (Fuji up close) → Tokyo → Hokkaido (always under snow) → Okinawa (turquoise sea), on a road that curves, climbs and drops.
- **Ground that reacts**: leaf and petal carpets scatter as you run through them; snow, rain, sand and dust spray at your feet.
- **Characters**: Kitsune, Tanuki, Shiba, Maneki-neko, Kappa, Tengu, Moon Rabbit — pick one for each road on the start screen (`?p1=`, `?p2=`).
- **Render** (`prototype/src/render/`): 65 procedural Japanese obstacle variants, fox and tanuki rigs, scenery for mountain / city / suburb / coast across four seasons, a wet-asphalt/flagstone/sand ground shader with puddle reflections and snow, a Shinkai-style sky (cumulus, comet, god rays, lens flare), instanced wind-swayed grass and flowers, seasonal particles (petals, tumbling leaves, snow, fireflies, rain, wind ribbons), bloom + anime grade.
- **Set pieces**: the collapsing bridge on the coast, an avalanche down the winter shrine stairs, a **tsunami** on the Shōnan coast (a water wall leans over the road and washes boats across it), a **bamboo forest fire** on the Hakone road (burning bamboo falls in from both verges, embers, smoke), and a **level crossing** in the suburbs (the bell rings, a train crosses ahead, the gate arms come down across every lane — slide).
- **Sound** (`prototype/src/audio/`): all synthesised in the browser, no files. A generative score with one theme per province and a Japanese pentatonic scale per season (yo / in-sen / hirajōshi, ryūkyū in Okinawa), tempo following your speed, taiko under the kaiju; ambience per biome (wind, sea, city hum, crickets, cicadas, rain); the typhoon's drone as the bar drains; shamisen stings on pickups, thuds, whooshes, a temple bell on every new province, a gong when the storm takes you. `M` mutes.
- **Online** (`?room=NAME`): race friends on other laptops. The room name is the road; everyone hits RACE and starts on the same count; rivals run beside you as translucent ghosts with name tags; every finished run is validated on the server by replaying its input log; standings at the end.
- **Tests** (`tests/`): 240,000-track solvability sweep, set-piece placement, replay determinism, powers, barging, autopilot, the score generator, and the room server end to end.

**Start screen**: pick a character for each road (live previews), Easy / Normal / Hard, and **God mode** (never die, see the whole journey). Single player runs a centred three-lane road; two players share the six-lane road. Esc/P pauses. Every hit tells you what you ran into and which move clears it.

`?seed=NAME` fixes the road (default: Seed of the Day), `?mode=1|2` skips the start screen, `?god=1` for god mode, `?bloom=0` disables post-processing, `?reduced=1` for reduced motion.

`server/` is the room server: it serves the game, starts races, relays 10 Hz position hints between laptops, and validates every finished run by replaying its input log with the same pure sim the browser runs.

---

## Run it

```bash
npm install          # installs socket.io for the server (three.js loads from a CDN)
npm run dev          # http://localhost:8080  — game + multiplayer server
npm test             # node --test
```

- **Solo, seed of the day:** `http://localhost:8080/`
- **Solo, fixed seed:** `http://localhost:8080/?seed=sleeper`
- **Race a friend:** open `http://localhost:8080/?room=NAME` on both laptops (on a LAN, use the host machine's IP instead of localhost; over the internet, put the server somewhere reachable). The room name *is* the seed, so everyone runs the same road. Type a name, hit **RACE**; the run starts for everyone on the same 3-2-1. Add `&name=…` to skip the name field.
- `?reduced=1` for reduced motion; `?bloom=0` disables post-processing on weak GPUs.

Without Node you can serve `prototype/` with any static server (`npm run serve` uses Python's) — solo and two-player modes work, online rooms need `npm run dev`.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Lane | `←` `→` / `A` `D` | swipe left / right |
| Jump (hold for height) | `↑` / `W` / `Space` | swipe up or tap |
| Slide (fast-fall in air) | `↓` / `S` | swipe down |
| Pause | `Esc` / `P` | |
| Sound on / off | `M` (or the ♪ button) | tap ♪ |
| Restart (ready up, in a room) | `R` | tap after death |

## How the pieces fit

```
prototype/src/core/     pure simulation — no Three.js, no Math.random; runs in browser, tests and server
  rng.js                mulberry32 + seed mixing
  chunks.js             generate(seed, index) → Chunk, solvability grammar, ChunkPool ring buffer
  player.js             buffered inputs, coyote time, variable jump, eased lanes, momentum
  world.js              Blink, saccades (the 3-lane window over 5 lanes), collisions, scoring, replay()
  protocol.js           room wire messages (join / ready / start / hint / run.end / result / standings)
prototype/src/render/   Three.js: renderer (pools, instancing, bloom, camera, set pieces, rival ghosts), props (merged vertex-coloured geometry, the rigs),
                        ground (stone path / wet asphalt shader with neon reflections), sky (dome, Fuji, ridges, tower), fx (petals, fireflies, rain, embers, trail, trains)
prototype/src/audio/    score.js (pure: scales, province themes, seeded bars) + audio.js (WebAudio synths, sequencer, ambience, sfx)
prototype/src/net/      Socket.io client: clock sync, 10 Hz hints, rival extrapolation, input log at the end
server/server.js        rooms: lobby → countdown → running, hint relay, replay validation, standings
```

The one idea everything hangs on: **a chunk is a pure function of `(seed, index)`** — and so is the music. Clients never exchange geometry — only 10 Hz position hints and, at the end, the input log — which is what lets two laptops race the same road with nothing but a room name in common.
