# KITSUNE — engineering handoff

Everything a fresh session needs to pick this up. For the *creative* brief (what the
game is trying to be), read `docs/KITSUNE_VISION_PROMPT.md` alongside this. For player
instructions, `docs/PLAY_KITSUNE.md`.

**Repo:** `nbhardwaj5139/Running-Game` · **Branch:** `claude/3d-endless-runner-design-u9kvmn`
(all work goes here; never push to another branch)
**Head at time of writing:** `37940b8` · **Tests:** 23 passing (`npm test`)
**Published build:** https://claude.ai/code/artifact/e0197a09-0ff0-403b-8e1f-f7991f1fcca9

---

## 1. What the project is

KITSUNE (狐) is a 3D endless runner set across Japan. A fox spirit runs the old road from
Kyoto to Okinawa while a typhoon chases it; the road bends, climbs shrine stairs and
passes through eight provinces as the seasons turn. Built as a zero-build Three.js
prototype plus a small Node server.

Two people have been working on it in parallel sessions (the owner and a collaborator,
Christopher), so **always `git pull` before starting** — the branch moves underneath you.

## 2. How to run it

```bash
npm install          # only needs socket.io, for the server
npm run dev          # http://localhost:8080  (server + static files)
npm test             # node --test tests/*.test.js
npm run serve        # static only, no server: solo and local 2P work, online does not
```

The prototype has **no build step**: `prototype/index.html` uses an importmap pulling
three@0.185.1 from jsdelivr and loads `src/main.js` as an ES module. Editing a file and
reloading is the whole dev loop.

## 3. Architecture — the one thing to understand first

**The simulation runs in track space; the renderer bends it onto a spline.**

The sim thinks the road is straight: positions are `(s along, lane/x across, h up)`. The
renderer maps every placement through a Catmull-Rom spline with parallel-transported
frames (`render/track.js`), so turns, climbs and shrine stairs cost the gameplay code
nothing. Solvability, powers, kaiju and autopilot never learned about curves.

- Global mapper hook: `TRACK.map` / `TRACK.shift` in `render/common.js`.
- Everything is placed through `compose()` or `placeMesh()`.
- Floors are bent per vertex via an `aTrack` attribute (`uBent` uniform).
- Basis is right-handed, `R = N × T`; the sim's x is left-handed so `map()` negates x.
  Getting this wrong back-face-culls the whole road — it looks like white ground.

**The sim is pure and deterministic.** No `Math.random`, no clocks anywhere in
`core/` (there is a test-visible grep for this in the co-op design notes). Chunks come
from `generate(seed, index, cfg)`. This is load-bearing: it is what makes replay
validation and networked co-op possible. **Do not introduce nondeterminism into `core/`.**

### Layout

```
prototype/src/
  core/          the simulation — pure, no rendering, no DOM
    rng.js         mulberry32 + seed mixing
    chunks.js      chunk generation, provinces, seasons, weather, set pieces, powers  (402 lines)
    player.js      one runner: lane easing, variable jump, slide, coyote time
    world.js       the sim: two runners, typhoon, collisions, powers, scoring         (290 lines)
    autopilot.js   lane scoring for the guided-crow power
    lockstep.js    deterministic co-op scheduler (see §5)
    protocol.js    wire message names, shared by client and server
  render/        Three.js view of the sim; never mutates it
    renderer.js    orchestrator: pools, camera, chunk attach/detach, post            (646 lines)
    track.js       the spline and its frames
    props.js       obstacle catalogue, power pickups, runner rigs                    (642 lines)
    scenery.js     everything dressing a chunk beyond the road                        (447 lines)
    ground.js      per-biome/surface ground shader
    sky.js theme.js fx.js vegetation.js characters.js deer.js litter.js common.js
  audio/         generative score (per province and season) + stings
  net/client.js  room client: join, ready, hints, co-op batches
  main.js        bootstrap: modes, input, HUD, room UI, frame loop                    (365 lines)
server/server.js rooms, race start, co-op relay, replay validation                    (162 lines)
scripts/share-windows.ps1  opens the Windows firewall for LAN co-op, prints the link
```

### Modes (`mode` in main.js)

| mode | what |
|---|---|
| 1 | solo — one runner, full six-lane road |
| 2 | two players on one keyboard |
| 3 | online **race** — own sim each, same seed, rivals drawn as ghosts from 10 Hz hints |
| 4 | online **co-op** — ONE shared world across two laptops (see §5) |

The road is the same six lanes in every mode. `?room=NAME` enters race, `?coop=NAME`
enters co-op, `?seed=`, `?diff=`, `?god=1`, `?mode=`, `?p1=`, `?p2=`, `?bloom=0` also exist.

## 4. Gameplay model (what the sim guarantees)

- Six lanes = two 3-lane tracks. Chunks are 36 m, six beats each.
- Every row is generated through a **reach-set solvability grammar** (`stepReach`): a row
  is only committed if it can be passed from the set of lanes you could actually be in.
  No unfair rows exist by construction; if generation cannot find one, it emits an empty row.
- Obstacle verbs: `stalk` change lane · `drusen`/`gap`/`wave` jump · `arch` slide ·
  `wide` take the free lane · `roller` time it.
- The typhoon bar is health. Hits cost margin; coins and clean running restore it; after
  the first km it also drains on its own, scaled by weather and set piece.
- Sections: `BIOME_LEN = 16` chunks per province (576 m), `SEASON_LEN = 32`, eight
  provinces per lap, and the season index is offset by the lap so each province sees all
  four seasons over time (that is what makes the winter avalanche reachable).
- 12 powers, weighted; `POWER_INFO` in chunks.js is the single source of names/blurbs/colours.
  The rocket (`rocket`) is the one *armed* power: the pickup sets `player.rocket`, an input
  `{kind:'fire'}` (Space; F for local player 2) launches it — and is a plain jump when nothing
  is loaded, decided in `Player.input`, so co-op machines never disagree. `World._rockets`
  flies it and marks what it destroys `cell.gone` (Susanoo's strikes do the same now), which
  every runner's collision loop skips.
- **Forks** (`forkAt`, `laneGroups`, `groupOf` in chunks.js): every `FORK_GAP` = 13 chunks, when
  nothing else is happening across the span, the six lanes are carved into 2 roads of 3 or
  3 roads of 2 for `FORK_LEN` = 4 chunks. Generation runs per road (`generateTrack` takes a
  base lane and a width) so each is solvable alone; every cell carries `grp`. The World locks
  each runner to the road under them at the split (`laneMin`/`laneMax`, `group`), filters
  collisions and barges by group, and emits `fork` events (`ahead` → `split` → `join`).
  `opts.forks === false` turns them off — main.js does that for local 2P only, because one
  camera cannot follow two roads. Every co-op machine must agree on the flag (they all send true).
  Rendering: `Renderer._forkOffset` adds each road's drift/lift/crab-yaw inside `TRACK.map`,
  so props, coins, runners and the camera ride their road for free; the land loses its road
  paint under a fork and each road becomes a bent deck (`_bendDeck`) with short railings.
  `TRACK.fork` forces a road index for things that sit on the seam (the railings); the camera
  uses it to stay with `renderer.focus` (your slot online, the fox otherwise).
- Set pieces are pure functions of chunk index (`setpieceAt`): bridge, avalanche, tsunami,
  fire, level crossing. Kaiju occupy the last 2 chunks of a season section; the roster
  (`KAIJU`, five of them — Gojira has `fire: true`) takes turns by section index. Gojira's
  thrown wreckage carries flames in the renderer (`t.flames`) and a breath is drawn from the
  rig's `mouth` to the object it just threw (`K.target`).

## 5. Networked co-op — the part most likely to need work

`?coop=NAME` puts two laptops in **one shared World**. Implemented as **deterministic
lockstep**, not state sync.

- An input pressed on tick T is scheduled to run on tick `T + COOP_DELAY` (6 ticks,
  100 ms) on **both** machines.
- Neither machine steps past a tick until it knows the peer's inputs for it. The wire
  promise is `upTo` = "I have sent every input I will ever have for ticks ≤ upTo", and
  because a local input always lands at `tick + delay`, the promise at tick T is
  `T + delay - 1`.
- Inputs for a tick are applied sorted by `(slot, seq)` so both machines apply them in
  the same order.
- Therefore only inputs cross the wire; state never does. The server relays and never
  simulates, so it cannot be the thing that desyncs a run.

Slots: **1 = right road (first to join), 0 = left road**. Seed, difficulty and god mode
are fixed by the server at START and sent to both — if these ever differ, the worlds
diverge, so anything that affects the sim must travel in START.

Every input in `main.js` goes through one `input(slot, evt)` funnel — keydown, keyup
(`jumpRelease`), and touch. **If you add an input path, route it through that funnel or
co-op will desync.**

Verified by `tests/coop.test.js` (4 tests): two worlds exchanging only inputs over a
simulated laggy link stay byte-identical over 40 s; also verified with two real browsers
against the dev server, where both ended with identical input logs.

## 6. Testing

`npm test` — 23 tests, all passing. Node's built-in runner, no framework.

- `chunks.test.js` — generation purity, solvability, section maths
- `world.test.js` — sim behaviour, replay determinism, section events
- `coop.test.js` — lockstep sync, slow links, the `upTo` promise
- `server.test.js`, `score.test.js`, `rng.test.js`

There is also a headless Playwright harness used during development (kept in the session
scratchpad, not the repo) that drives the real page for screenshots and for the two-browser
co-op check. Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; route
`cdn.jsdelivr.net` to a local three copy and use `waitUntil: 'domcontentloaded'` — the
socket keeps the network busy so `networkidle` never fires.

## 7. Conventions and gotchas learned the hard way

- **No camera shake, ever.** The user asked for this repeatedly. Impacts are shown with
  hurt flashes, shock rings and the HUD readout, never by moving the camera.
- **Never add a mechanic that slows the player down.** A slow-time power was built and
  then deliberately removed for this reason.
- Camera rides the road's own spline frame, behind the runner's lane, looking into the
  turn ahead. No roll.
- Weather must stay readable — an earlier build clouded most of the screen and was toned down.
- Performance: pixel ratio capped at 1.5 with an adaptive render scale that drops under
  load and climbs back; bloom renders at half resolution; instancing everywhere.
- **PowerShell scripts must be plain ASCII with a UTF-8 BOM.** Windows PowerShell 5.1
  reads a BOM-less file in the ANSI codepage, so an em dash becomes mojibake containing a
  curly quote, which swallows the string and produces a parse error dozens of lines later.
- Windows PowerShell 5.1 has no `&&`.
- The artifact is a single bundled HTML file produced by a scratchpad script that wraps
  each module in an IIFE and rewrites local imports. The module order list must include
  any new module (`core/lockstep.js` was added to it).

## 8. Where things stand / open items

**Working:** solo, local 2P, online race, online co-op, generative sound, five set pieces,
five kaiju, 12 powers, eight provinces, four seasons, forks, samurai on the shrine road,
adaptive performance.

**Live blocker (environmental, not code):** the owner is trying to host co-op for a friend
on Windows. Diagnosed so far:
- Server binds all interfaces; no hardcoded localhost anywhere. Code side is clean.
- The Windows firewall is now open via `scripts/share-windows.ps1` (`-Profile Any`,
  which matters because both their networks report as Public).
- The remaining suspect is the network itself: they are on **`BP-Guest`**, a guest SSID.
  Guest networks normally run client isolation, which blocks device-to-device traffic at
  the access point and cannot be fixed from either laptop.
- Next step given to them: `Test-NetConnection <host-ip> -Port 8080` from the friend's
  machine. If false on the same subnet with the firewall open, the answer is to move both
  machines to a phone hotspot (hotspots do not isolate clients) and re-run the script.
- A Cloudflare quick tunnel was tried and abandoned; the user disliked it.

**Not started / ideas:** the rocket's blast could scare deer / knock the kaiju's hand; more set pieces (festival float, lantern festival, fireworks);
a persistent named tunnel for remote co-op; more than two players in co-op (the lockstep
generalises, the room seating does not).

**Unverified old report:** "some barriers in the air instead of on the floor in the city"
— never reproduced across many screenshots. Worth a look if it resurfaces.

## 9. Working agreements with the user

- Commit and push to `claude/3d-endless-runner-design-u9kvmn`; do not open PRs unless asked.
- Commit trailers required:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and
  `Claude-Session: <session url>`. No model names in repo content itself.
- The user does not want time spent on headless smoke tests as a matter of routine
  ("you can build great without doing it"), though screenshot checks for large visual
  changes have been welcome.
- Keep the artifact at the existing URL by republishing the same file path; note that the
  share link may be pinned to an older version, which is changed from the artifact's own
  share menu, not from the tooling.
