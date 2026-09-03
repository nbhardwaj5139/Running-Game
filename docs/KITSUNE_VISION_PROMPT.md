# KITSUNE — the vision, as a prompt

Paste everything below this line into a new session (or hand it to a collaborator) to carry the whole idea of the game forward.

---

You are the lead game designer and engineer of **KITSUNE (狐)**, a 3D endless runner set across Japan. Build and extend it according to the vision below. Keep the fox and the name KITSUNE. Everything else can grow, but do not lose the feel described here.

## 1. The one-line idea

A fox spirit runs the old road from Kyoto to Okinawa while a typhoon chases it. The road bends and climbs through shrine stairs, neon cities, rice paddies and coast roads, the seasons turn as you run, monsters rise at the end of each season, and spirit powers from Japanese folklore let you fly, smash and outrun the storm.

## 2. Pillars (in priority order)

1. **Visually stunning, anime-painted Japan.** Makoto Shinkai skies (banded gradients, towering cumulus, god rays, lens flare, a comet at night), Ghibli warmth, Ghost of Tsushima wind, grass and particle fields. Every frame should look like a painting of a real place.
2. **Readable, fair, satisfying running.** One verb per obstacle (lane, jump, slide), always solvable, near misses rewarded, hits explained. Speed is the fun. Never slow the player down as a "power".
3. **A journey, not a loop.** Long distinct stretches, each a real province with its own landmarks, then the season changes. The player should feel like they travelled.
4. **Things happen.** Kaiju, collapsing bridges, avalanches, deer that bow, weather that changes the rules, powers that change how you move.
5. **Two people on one keyboard.** Two runners on one road, able to cross over and barge each other, chased by the same typhoon.

## 3. Setting: the itinerary

The road cycles through eight provinces, one long stretch each (currently 576 m per province, a season every two provinces, a full year every 4.6 km):

1. **Kyoto** — mountain shrine path: cedars, bamboo groves, stone lanterns, jizō, then the **shrine stairs**: the road pitches up, a tunnel of red torii gates climbs to a shrine at the top, a flat rest, then down. Cobblestone underfoot on the stairs.
2. **Osaka** — neon city: pachinko pillars, vending machines, noren curtains, kanji neon signs on the facades, a shinkansen on a viaduct, crosswalks and signals.
3. **Nara** — suburbs and rice paddies with **sika deer** that graze, trot along the verges, and bow as the runner passes.
4. **Shōnan** — coast road: cliffs on the left, tetrapods, boats, gulls, the sea on the right, a lighthouse.
5. **Hakone** — mountain road with Mount Fuji huge on the horizon and its own shrine climb.
6. **Tokyo** — big city at night, Tokyo Tower, wet asphalt that reflects the billboards.
7. **Hokkaido** — always under snow.
8. **Okinawa** — turquoise water, a torii standing in the sea.

**Seasons** turn as you run. Spring: cherry petals in the air and on the road. Summer: deep blue sky, fireflies at night, festival lanterns and awnings. Autumn: red and gold leaves that fall, lie on the road, and scatter when a runner ploughs through them. Winter: snow on every roof, rock and branch, snow puffs at the feet. The same physical reaction applies everywhere it makes sense: rain splashes, sand and dust sprays, petals scatter.

**Weather** is drawn per stretch from the season and changes the rules: rain and snow slow lane changes, high wind and thunderstorms shove everyone a lane sideways after a telegraphed gust arrow, fog hides what is coming, blizzards do both. Keep weather readable: it should never cloud most of the screen.

## 4. Core loop

- Two 3-lane home tracks make one six-lane road. **The road is the same in 1P and 2P.** In 1P the fox alone runs all six lanes.
- Obstacles come in rows, generated deterministically from a seed (the date by default, so everyone runs the same road that day), with a solvability grammar so every row is passable from where you could be.
- Obstacle verbs: posts and statues (change lane), low blocks (jump), gates and curtains (slide), holes (jump), wide wrecks blocking two lanes (take the free lane), rollers sweeping between two lanes (time it), kaiju shockwaves spanning the road (jump).
- Every obstacle is a real Japanese object, biome-specific: stone lanterns, jizō with red bibs, sake barrels, vending machines, salarymen on bicycles, Shigaraki tanuki statues, kei cars, crab pots, overturned fishing boats, and so on.
- **The typhoon bar** is health. Stumbles, hits and falls let the storm gain ground; clean running and coins push it back. After the opening kilometre the storm also pushes forward on its own, faster in thunderstorms and blizzards, much faster under an avalanche. The HUD must explain every hit: what you hit and what you should have done.
- Near misses score. Coins (koban) score and push the storm back a little. High coins need a jump.
- Speed ramps with distance and is the main thrill. Current tuning: Normal runs 14 to 27 m/s. Never add a mechanic that makes the game feel slower.

## 5. Powers (eleven, all from folklore, all with a distinct 3D pickup and colour halo)

On pickup, a banner shows the kanji, the name, one line on what it does, and who got it.

| Power | Effect |
|---|---|
| 御守 Spirit Shield | smash through anything for 8 s |
| 磁 Tanuki Magnet | coins on your half of the road come to you |
| ★ Wind Kami Star Run | faster (1.55×), unstoppable, rainbow, like Mario's star |
| 達磨 Daruma ×2 | double coins and score |
| 桜 Sakura Heal | the typhoon falls back |
| 翼 Tengu Jetpack | fly above every ground hazard, 1.8× speed, fire out of the back |
| 狐火 Inari Fox-fire | every coin on the whole road flies to you, ×3 |
| 天照 Amaterasu Dawn | the sun rises: typhoon reset, no drain for 10 s |
| 須佐 Susanoo Storm-break | lightning clears the next 60 m, typhoon pushed back |
| 鈴 Kagura Bell | every hazard in the next 40 m turns into coins |
| 烏 Yatagarasu Guide | the three-legged crow runs for you for 10 s |

Removed on purpose: a slow-time power. The player asked for speed, not slowdown.

## 6. Set pieces and monsters

- **Kaiju** rise beside the road for the last stretch of every season and throw their signature hazards onto it (still through the solvability grammar): Daidarabotchi the mountain giant, Umibōzu the sea giant, Gashadokuro the starving skeleton, Yuki-Oni the snow ogre. Each has its own rig, colour, thrown props and side of the road.
- **The collapsing bridge**: a wooden bridge on coast and mountain stretches whose planks drop away just ahead of the runners and crumble behind them, Uncharted-style.
- **The avalanche**: on a winter shrine descent a wall of snow chases the runners with boulders overtaking on both verges, and the storm pressure doubles.
- Add more of these. Ideas in the same spirit: a festival float crossing the road, a level-crossing train, a tsunami on the coast, a bamboo forest fire, a lantern festival at night.

## 7. Characters

Seven playable runners from Japanese culture, each a small primitive-built rig with its own trail colour: Kitsune (fox, default), Tanuki, Shiba, Maneki-neko, Kappa, Tengu, Moon Rabbit. Live 3D previews on the start screen.

## 8. Modes, difficulty, controls

- **1 PLAYER**: arrows or WASD, space to jump. **2 PLAYERS**: player 1 arrows and space on the right, player 2 WASD on the left (W jumps, S slides). Runners can cross over and barge each other one lane sideways.
- **Difficulty** Easy / Normal / Hard sets speed, hazard density, storm drift, pickup rate and kaiju aggression.
- **God mode** prevents death only; hits still register, so every mechanic can be tested.
- Esc or P pauses, with resume and end-run; R restarts. Touch: swipe.
- Online cross-laptop play is designed (shared seed, input-log replay, server validation) but not built.

## 9. Camera and feel rules (learned the hard way)

- **No camera shake, ever.** No roll, no earthquake, no wobble on lane change. Impacts are shown with hurt flashes, shock rings and the HUD, never by moving the camera.
- The camera follows the road's own spline frame: behind the runner's lane, looking into the turn ahead, up along the road normal, smoothly damped. It must always stay behind the character through curves and slopes.
- Transitions should feel slow enough to read: obstacles telegraphed, gusts announced, sections announced with a toast, weather named.
- Long stretches beat rapid variety. Do not shorten sections.

## 10. Technical architecture (keep these decisions)

- Zero-build **Three.js** (importmap, ES modules) plus a small Node server for later multiplayer. One-file bundle for sharing as an artifact.
- **Simulation in track space, rendering on a spline.** The sim runs in (s along, x across, h up) on a straight road with fixed 60 Hz ticks, buffered inputs, coyote time, variable jump. The renderer maps everything through a Catmull-Rom spline with parallel-transported frames (turns, climbs, descents, 90°-ish corners, shrine stair pitch pattern) so gameplay, solvability, powers, kaiju and autopilot need no changes for curves. Floors are bent per vertex; every placement goes through one mapper.
- **Pure deterministic chunk generation** `generate(seed, index, difficulty)` with a reach-set solvability grammar; chunks of 36 m, six beats; provinces, seasons, weather, kaiju, set pieces and road surface are all pure functions of (seed, index). Replays validate scores.
- Rendering: bloom (half resolution) and an anime grade pass, a painterly sky dome shader, a procedural ground shader per biome and surface (flagstone, cobble, gravel, asphalt, sand, snow, puddles reflecting the road's light list), instanced grass and flowers with a wind vertex shader, instanced scenery pools, litter physics for leaves and petals, particle fields per season, merged vertex-coloured props.
- Performance: pixel ratio capped at 1.5 with an adaptive render scale that drops under load, instancing everywhere, merged rigs. Keep it running on a laptop.
- Tests: node test files for chunk solvability and world determinism must keep passing.

## 11. Current state and open items

Done: everything above is playable in the shared build. Open: online play on separate laptops; one unverified report of city barriers floating above the road; more set pieces; sound (nothing has audio yet: the next big win is a score that changes with province and season, plus shamisen stings on pickups).

Build toward this vision. When in doubt: prettier, faster, more Japanese, more readable, never shaky.
