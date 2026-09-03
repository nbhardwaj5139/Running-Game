# VITREOUS — Game Design Document

> *"Something enormous is asleep. You live in its eye. Don't let it blink."*

**Genre:** 3D endless runner (Temple Run loop) with a world-shifting twist and shared-state multiplayer.
**Platforms (in order):** Web (WebGL2, instant-play links) → iOS/Android wrappers → Steam/consoles.
**Session length target:** 60–180 s per run, 6–10 runs per session.
**Design pillars:**
1. **The world moves, not you.** The signature *saccade* mechanic shifts the track under the runner. Skill = reading the eye.
2. **Multiplayer through a shared body.** Rivals don't throw barrels; they spend a resource that twitches the *same* eye you're running in.
3. **Fair, readable, fast.** Every hazard has a 1.2 s telegraph; every death is legible; restart in < 1 s.

---

## 1. Setting & Narrative Concept

Three original settings were developed. **Concept A (Vitreous) is the recommended lead** because its signature mechanic is *mechanical*, not just cosmetic, and it maps cleanly onto the multiplayer design in §2. Concepts B and C are viable "season" biomes for the same engine (see §4, *Dream Cycles*).

### Concept A — VITREOUS *(recommended lead)*

| | |
|---|---|
| **Where** | Inside the eye of a colossal dormant being, "the Sleeper." You run along the **retinal canopy** — a lattice of capillary "roads" suspended over a field of photoreceptors, under a dome of gelatinous vitreous humour. Light arrives from the front, filtered through a half-closed lid, as slow-moving phosphenes. |
| **Who you are** | A **Floater** — a mote of cellular debris that has, against all odds, become aware. Floaters drift; you are the first one that *runs*. |
| **Why you run** | The Sleeper is waking. When the eye blinks, the vitreous churns and everything loose is flushed to the drain. You run toward the light because light keeps the eye open. |
| **Chasing force: THE BLINK** | A wall of eyelid-shadow and tear-film sweeping up the retina from behind. It is not a creature — it is a *reflex*. Clean running and collected photons keep the eye open (the Blink recedes). Every stumble makes the lid twitch (the Blink surges). When it reaches you: *"The Sleeper blinked. You were never there."* |
| **Signature mechanic: SACCADES** | Every 12–25 s (and on demand in multiplayer) the eye twitches. The whole track slides one lane left or right under the runner over 250 ms after a 400 ms telegraph (iris flare on the horizon + rumble on the side it will move toward). The runner does not move — the world does. A gap that was in your lane is now beside you; a safe lane is now a stalk. **Reading the telegraph direction is the core skill.** The track is 5 lanes wide; the runner ever only sees a 3-lane "window" of it, and saccades slide that window. |

**Thematic obstacles** (each has exactly one escape, so the grammar is readable):

| Obstacle | Look | Escape | Failure |
|---|---|---|---|
| **Capillary arch** | A crimson vessel bowed low across a lane | **Slide** | Stumble (Blink +) |
| **Rod stalk** | A tall pale photoreceptor column | **Change lane** | Stumble (Blink ++) |
| **Drusen** | Waxy yellow lipid mound on the road | **Jump** | Stumble (Blink +) |
| **Vitreous tear** | A gap in the lattice into black gel | **Jump** | Fall — instant death |
| **Macular clot** | Full-width wall of clotted blood with one pulsing gap | **Be in the gap lane** (telegraphed 2 chunks early) | Death |
| **Phosphene storm** *(post-launch)* | A shimmering zone; controls mirror while inside | Ride it out / avoid | — |
| **Tear channel** | A glossy slipstream in one lane | Ride it | — (speed + score ×2) |

**Collectibles:** **Photons** (score + soft currency; strung in lines, arcs, and over-jump arcs) and **Luciferin** (rare glowing motes; feed the *Nerve* meter — see §2).

**Narrative delivery (no cutscenes):** Every 500 m the light through the lid resolves into a **Dream Page** — one line of what the Sleeper is dreaming about. Pages are collected into the *Dream Journal* in the menu. The pages, read in order, slowly reveal who the Sleeper is and that the Floater's running is what is *keeping it asleep*. The final page (10 km) is intentionally reachable only by top players.

### Concept B — THE LONG FALL *(season biome)*

- **Where:** A whale carcass sinking to, and decomposing on, the abyssal floor. Time is compressed: ecological succession happens *as you run*. The run starts on the bloated flank (Stage 1: mobile scavengers — sleeper sharks, hagfish swarms as moving obstacles), moves into the enrichment stage (Stage 2: *Osedax* worm forests to slide under), then the sulfophilic stage (Stage 3: bacterial mats that are slipstreams, clam beds as drusen-equivalents), and finally the reef stage (Stage 4: bone that has become mineral — hard-edged, geometric, fast).
- **Who you are:** A **bone-eating courier worm** carrying a symbiont that must reach the skull before the fall ends.
- **Chaser: THE BLOOM** — an anoxic sulfide tide rising up the carcass. It doesn't chase you so much as *rise*; going downhill fast is the only escape. Stumbles slow your descent.
- **Twist mechanic:** The track is vertical-ish (a 30° descent). "Jump" is a kick-off that carries much farther, "slide" is *burrowing into bone* (you go inside the track for 0.6 s — lets you pass under mobile scavengers).
- **Why it's interesting:** The biome changes are *authored by distance*, so the procgen chunk catalog is partitioned by stage and difficulty simultaneously — a natural fit for the generator in the blueprint.

### Concept C — CANTICLE *(season biome / rhythm mode)*

- **Where:** Inside a cathedral pipe organ the size of a city. You run down the windways and across the reed boards while the organ is being played.
- **Who you are:** A **stray note** — a sound that escaped its pipe.
- **Chaser: THE REST** — an advancing fermata of silence that *erases geometry* as it goes. Where it has passed there is no floor.
- **Twist mechanic:** Hazards land on the beat. The track is generated from a procedural score (a Markov chain over chord progressions in the seed's key); reed stops open and close on the bar, chords appear as clustered stalks, and lane changes play notes. Performing the escape *on the beat* multiplies score. This is the only concept where the audio *is* the telegraph.
- **Why it's interesting:** Same engine, different generator inputs: the chunk selector consumes a tempo track instead of a difficulty curve.

---

## 2. Multiplayer Mechanics

All modes share one architectural fact that makes them cheap and latency-tolerant: **the track is a pure function of `(seed, chunkIndex)`** (see blueprint §1). Any two clients with the same seed see the *same* track without ever sending geometry. Multiplayer only has to synchronise *events* and *positions* — a few hundred bytes per second per player.

### 2.1 Recommended: SHARED NERVE *(real-time, 2–4 players, indirect sabotage)*

> Everyone runs in the same eye. There is **one** Nerve meter. Whoever spends it twitches the eye — for everyone.

- **Setup:** 2–4 runners on the same seeded track, running simultaneously. Rivals render as translucent *afterimages* in your world (same lanes, same obstacles). No collision between players.
- **The Nerve meter (shared):** A single server-authoritative gauge (0–100) that *every* player charges: near-misses +5, photon streaks +2/photon, Luciferin +25.
- **Spending it:** Any player can hold **Left/Right + Nerve** to spend 40 Nerve and fire a **saccade** in that direction. It hits everyone, *including the spender* — but the spender chose the direction and receives the telegraph 150 ms earlier than rivals (400 ms vs 250 ms). The spender also gets a small speed boost for 2 s (the eye "looks toward" them).
- **Blink reflex:** Every spent saccade also surges the Blink toward the **last-place runner** (−6 m of margin). Being last under a saccade barrage is lethal; leading is comfortable. This creates rubber-banding *in favour of the leader* — deliberately, because sabotage games usually punish leaders and players hate it. Instead, the counterplay is **denial**: the meter is shared, so a trailing player can fire saccades early in useless directions to keep the leader from ever having 40 Nerve at a critical moment. Bluffing over a shared resource is the meta.
- **Endgame:** Last runner alive wins; ties by distance. Matches last 90–150 s. A "Sudden Blink" ruleset accelerates the Blink for all after 120 s.
- **Why it beats ghost racing:** The interaction is *strategic* (a shared economy), *legible* (a saccade is visible to everyone), *fair* (the spender eats it too), and *cheap* (one 8-byte event per saccade, no physics sync). It also works at 200 ms ping because saccades are scheduled 300 ms in the future on a shared tick clock (blueprint §2).

### 2.2 Interference: PHOSPHENE THROW *(parallel lanes)*

Two tracks side by side, separated by a translucent vitreous membrane. Photons you collect fill a *throw* charge; throwing lobs a phosphene bloom into the rival's lane that **occludes** (a blinding light-fog that hides the next 15 m) rather than blocks. It never creates an unwinnable situation, only an unreadable one. The rival can dispel it by sliding through a tear channel. Simpler than Shared Nerve; good as a 1v1 side mode.

### 2.3 Co-op: OPTIC TWINS *(tethered)*

Two Floaters bound by a **nerve fibre**. The fibre's length is a resource: stretched taut across a macular clot, it *cuts* the clot open (both runners must be in different lanes at the wall). Slack fibre accumulates "charge" that both can spend for a shared jump-boost. If one dies the other runs on with a frayed fibre and *half* jump height until they collect enough Luciferin to "re-splice" (revive) the partner at the next Dream Page. Alternate-control variant for couch co-op: the fibre passes control back and forth every 8 s with a 1 s handover flash.

### 2.4 Asymmetric: DREAMER vs. FLOATER

Player 2 is **the Sleeper's dream**. They see a top-down 6-chunk preview and a **REM budget**: place drusen (5), spawn an arch (8), trigger a saccade (20), dim the light (fog, 15). Budget refills from the *Floater's photons* — a good runner feeds the Dreamer, which keeps the pressure proportional to skill. The Dreamer wins if the Floater dies before 2 km; the Floater wins by reaching it. Best as a streamer/party mode: the Dreamer's view is a great spectator feed.

### 2.5 Asynchronous: AFTERIMAGE

Friends' best runs on today's seed are rendered as **retinal afterimages** — but they *reshape your track*: where a friend died, a **scar** (extra drusen) remains; where they had a 20-photon streak, a **tear channel** appears. Your world is literally marked by the people who ran before you. Zero server cost beyond storing an event log per run (~2 KB).

---

## 3. Technical Blueprint — summary

The full blueprint (procgen architecture, networking, movement pseudocode) is in [`TECHNICAL_BLUEPRINT.md`](./TECHNICAL_BLUEPRINT.md). Summary of the recommendation:

| Decision | Choice | Reason |
|---|---|---|
| **Engine** | **Web: Three.js + TypeScript + Vite** (WebGL2, WebGPU-ready) | Instant-play links are the growth loop for a multiplayer runner. Same JS sim runs on the server for validation. Unity C# + Netcode for GameObjects is the fallback if store presence on mobile is the *first* target — the blueprint gives the mapping. |
| **Netcode** | **Node + Socket.io** (prototype) → **Colyseus** rooms (production). Deterministic seeded sim + server-scheduled events on a shared tick clock. | Only events and low-rate position hints cross the wire. Latency-tolerant by construction. |
| **ProcGen** | Grammar-constrained, seeded per-chunk generation with a "breathing" difficulty curve; ring-buffer chunk pool; instanced meshes. | `(seed, chunkIndex)` → chunk with no shared state, so clients (and the server) generate identical tracks independently and out of order. |
| **Movement** | Fixed 60 Hz sim, input buffering, coyote time, variable-height jump, lane easing, momentum curve, stumble state. | See pseudocode in blueprint §3. |

The `prototype/` folder in this repo is a runnable Three.js implementation of the blueprint (single-player + Shared Nerve over Socket.io).

---

## 4. Core Game Loop, Progression & Monetization

### 4.1 Core loop (run scale, 60–180 s)

```
   ┌──────────────────────────────────────────────────────────────┐
   │  RUN  ──► read telegraph ──► act (lane / jump / slide)       │
   │    ▲            │                     │                      │
   │    │       saccade!            near-miss / photons           │
   │    │            │                     │                      │
   │    │            ▼                     ▼                      │
   │    │     window shifts         Nerve ↑, Blink recedes        │
   │    │            │                     │                      │
   │    └────────────┴───── stumble ───────┘  → Blink surges      │
   │                                          → 3rd surge / gap = DEATH
   └──────────────────────────────────────────────────────────────┘
        DEATH ─► "The Sleeper blinked" ─► bank photons ─► ONE-TAP RETRY (<1 s)
```

**Tension curve inside a run.** Difficulty is not monotonic; it *breathes*. The generator alternates 3–5 tense chunks with 1–2 release chunks (photon lines, tear channels) so players get a rhythm of dread → relief. Saccade frequency rises with distance; saccade *telegraph* never shrinks below 250 ms (accessibility floor).

**Speed.** `speed = 11 + 5·log2(1 + distance/400)`, capped at 24 m/s (~8 min to cap; nobody gets there). Speed is *earned by survival*, never by pickup, so the pacing is predictable.

### 4.2 Session loop (5–15 min)

1. **Seed of the Day** — one global seed; everybody runs the same eye; leaderboard resets daily. The runner's ID, seed and event log are all that's stored, so a replay costs 2 KB.
2. **Three Daily Reflexes** — small objectives ("slide under 12 arches", "survive 3 saccades without stumbling") that pay Photons.
3. **Dream Page** discovery — narrative reward for distance milestones.
4. **Afterimages** of friends on the day's seed (async MP) show up automatically — no matchmaking friction.

### 4.3 Progression (meta, days–weeks)

| System | What it does | Why |
|---|---|---|
| **Dream Journal** | 20 Dream Pages unlocked by cumulative *and* single-run distance. | Narrative long-tail; gives goals to mid-skill players (cumulative) *and* elites (single-run). |
| **Floater Forms** | Cosmetic body shapes (mote, filament, ring, cluster). | Identity in multiplayer afterimages. |
| **Trails** | *Environmental* cosmetics: your wake leaves phosphene colour, ripples, or scar-light on the retina. Visible to rivals. | The most desirable cosmetic in a game where others see your *path*. |
| **Iris Themes** | Change the light colour of the whole world (amber, cyan, ultraviolet, monochrome). | Cheap to build (one uniform), high perceived value. Includes colour-blind-safe sets for free. |
| **Lenses** | Camera FOV/tilt presets. | Accessibility + streamer flavour. Always free. |
| **Reflex Rank** | Seasonal skill rating from Shared Nerve matches (Glicko-2). | Competitive ladder without pay influence. |

**Explicitly not in the game:** no energy/lives timers, no upgrades that change hitboxes or speed, no purchasable revives, no loot boxes.

### 4.4 Monetization (non-intrusive)

| Stream | Details | Guardrails |
|---|---|---|
| **Dream Cycles (season pass)** | 8-week seasons: a free track and a premium track (~$5). Premium track = Trails, Forms, Iris Themes, one new biome cosmetic set (Long Fall, Canticle). | 100 % cosmetic. Premium track can be earned in-game with Photons *over the season* (slowly), so buying is a time-skip, not a gate. |
| **Direct cosmetics** | Individual Trails/Forms $1–3. | No random bundles. What you see is what you buy. |
| **Opt-in rewarded ad** | After death, *once per session*, watch an ad to bank 2× Photons for that run. | Never a revive; never mid-run; never required. Off in the paid *Lucid* tier. |
| **Lucid (one-time $4)** | Removes ads, unlocks Custom Seeds and private Shared Nerve rooms with rulesets. | Utility, not power. |
| **Creator seeds** | Streamers can mint a named seed (`vitreous.gg/s/<name>`) — free; premium lets them attach a Trail as a "creator drop." | Growth loop rather than revenue. |

**KPI targets (soft-launch):** D1 40 %, D7 18 %, avg 8 runs/session, ≥ 25 % of players see one Shared Nerve match in their first session (the shared-seed afterimages are the on-ramp). ARPDAU is expected to be modest ($0.03–0.05); the model is *breadth via instant links*, not whales.

### 4.5 Accessibility & fairness (non-negotiable)

- Saccade telegraph has *three* channels: visual (iris flare), audio (rumble panned to the direction), haptic (mobile). Any one is sufficient.
- Colour-blind-safe Iris Theme is free and default-suggested when the OS flag is set.
- Input remap, one-handed mode (tap left half / right half), reduced-motion mode (saccade becomes a hard cut with a longer 500 ms telegraph).
- Deterministic sim + server replay means leaderboards can be *validated*, not just trusted (blueprint §2.5).

---

## Appendix — one-page pitch

**VITREOUS** is an endless runner where the *world* twitches under you. You are a mote of debris that became aware inside the eye of something enormous and asleep, and you run toward the light because light keeps the eye open. Behind you is the Blink. In multiplayer you and your rivals share the same eye — and the same nerve that makes it twitch. Whoever spends it moves the world for everyone. Read the eye, or be flushed.
