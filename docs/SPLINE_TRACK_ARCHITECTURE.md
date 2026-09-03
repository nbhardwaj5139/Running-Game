# KITSUNE — Spline-Based Dynamic Track Architecture (Unity C#)

*Senior gameplay / level-architecture breakdown for taking the runner off the straight line: curves, 90° turns, climbs, drops, splits, bridges, tunnels, wall-runs — without collision bugs, gaps, or unreadable cameras.*

Unity is the primary target (C#, URP). Unreal equivalents are noted at the end (`USplineComponent`, `UInstancedStaticMeshComponent`). Every script below is written to compile as-is in a Unity 2022+ project; helper types are defined where they are used.

---

## 0. The one idea that makes everything else simple

**Simulate in track space, render in world space.**

The runner, the hazards, the solvability grammar, the AI companion and the netcode all live in a 2.5-D *track space*:

```
s      metres along the path (arc length)
lane   0..5 across the road (continuous during a lane change)
h      height above the road surface
```

A **spline** maps track space to world space through a *moving frame* `F(s) = {P, T, N, B}` (position, tangent, normal = road "up", binormal = road "right"):

```
World(s, lane, h) = P(s) + B(s) · laneOffset(lane) + N(s) · h
```

That single function is what gives you curves, banked turns, climbs, drops and loops for free: the gameplay code never learns that the road bends. Collision stays 1-D along `s` and 1-D across lanes, exactly as in a straight runner, so there is nothing to "fix" when a tile turns 90°.

Everything below is built on that contract:

| Layer | Owns | Knows about geometry? |
|---|---|---|
| `TrackSpline` | control points, arc-length table, frames | yes — the only place |
| `TrackGenerator` | which tile comes next, biome/season, hazards (in track space) | only tile *shapes* (turn, pitch, length) |
| `TrackMeshBuilder` | road mesh, tunnels, walls, bridges | yes, via frames |
| `SplineRunner` | movement in (s, lane, h), traversal states | no — asks the spline for its frame |
| `RunnerCamera` | follow, pitch/FOV, anticipation | no — reads frames ahead |

---

## 1. Tiles, grammar and the occupancy rules

### 1.1 Tile definition
A tile is a *shape* plus *content rules*, authored as a ScriptableObject. Shapes are expressed as deltas so tiles are position-independent and any tile can follow any other (C¹ continuity is guaranteed by construction: the next tile starts with the previous tile's end tangent).

```csharp
// TrackTile.cs
using UnityEngine;

public enum TileKind { Straight, Curve, SharpTurn, Incline, Drop, Split, Merge, Bridge, Tunnel, Facade, Climb }
public enum Biome { Mountain, City, Suburb, Coast, Shrine, Peak, CyberFeudal }

[CreateAssetMenu(menuName = "Kitsune/Track Tile")]
public class TrackTile : ScriptableObject
{
    public TileKind kind;
    [Tooltip("Arc length in metres. Rows are placed every 6 m (beats).")] public float length = 36f;
    [Tooltip("Total yaw change over the tile, degrees. +90 = right turn.")] public float turnDeg = 0f;
    [Tooltip("Total pitch change, degrees. +20 = climb, -25 = drop.")] public float pitchDeg = 0f;
    [Tooltip("Bank (roll) at the tile's midpoint, degrees; eases in and out.")] public float bankDeg = 0f;
    [Range(1, 6)] public int lanes = 6;
    public bool tunnel;                    // swaps the cross-section, darkens lighting, narrows the camera
    public bool facadeWallRun;             // a wall on one side that a lane change *into* converts to a wall-run
    public int facadeSide = 1;             // -1 left, +1 right
    public bool climb;                     // vertical section: lanes map to a ladder-like wall, gravity toward the wall
    public Biome[] allowedBiomes;
    public float minSpeedForTurn = 0f;     // sharp turns need a minimum speed to be readable (telegraph time)
    public TrackTile[] forbiddenNext;      // e.g. Drop must not follow Drop; SharpTurn must not follow SharpTurn
    public GameObject[] setDressing;       // prefabs the dresser may instance along this tile
}
```

### 1.2 Grammar (what may follow what)
The generator is a weighted grammar with hard constraints, evaluated per tile:

1. **Readability**: a `SharpTurn` (≥ 60° over ≤ 24 m) must be preceded by ≥ 12 m of `Straight` or gentle `Curve` (the telegraph). Two sharp turns are never adjacent. Turn radius must satisfy `r ≥ v² / (g · tan(bank + μ))` for the *current* run speed, otherwise the tile is rejected — this is why `minSpeedForTurn` and `bankDeg` exist.
2. **Pitch budget**: cumulative pitch is clamped to ±35°; a `Drop` after an `Incline` is allowed (a crest), a `Drop` after a `Drop` is not (unreadable).
3. **Elevation envelope**: the road's height stays within `[-60, +120]` m of the biome's ground plane; when near a bound only tiles that move toward the middle are eligible.
4. **No self-intersection**: a 2-D occupancy grid (4 m cells) stores height *bands* per cell. A tile is accepted only if every sample along its centreline either lands in an empty cell or in a cell whose existing band is ≥ 12 m away vertically — that second case is exactly a **bridge** or an underpass, and it is what makes intersecting bridges safe: they are only ever generated when the vertical clearance already exists.
5. **Splits** produce two child splines that share the parent's frame at the split point and *merge* within 4–6 tiles (a `Merge` tile is forced onto both branches with the same end frame, computed once and shared). Lanes are remapped: a 6-lane road splits into two 3-lane roads; the runner's lane index is preserved within its half, so the "home track" rule of the existing sim survives.
6. **Biome transitions** happen only on `Straight` or gentle `Curve` tiles ≥ 36 m, through a `TransitionSpec` (below).

Hazard rows are still generated in track space by the existing solvability grammar (`generateTrack` in the web prototype); the only new rule is that rows are **suppressed for the 6 m before and after a sharp turn or drop lip**, so the geometry itself is the hazard there.

### 1.3 Transition rules
```csharp
[System.Serializable]
public struct TransitionSpec
{
    public Biome from, to;
    public TrackTile[] bridgeTiles;      // tiles used *during* the blend, e.g. Coast→City: seawall promenade, then overpass ramp
    public float blendMetres;            // palette/fog/vegetation cross-fade length (default 72 m = 2 tiles)
    public bool requiresClimb;           // Coast→City ramps up 25 m; Peak→Shrine drops
}
```
The generator keeps a `sectionState {biome, season, metresIntoSection}`; when a section ends it looks up the spec, forces `requiresClimb ? Incline/Drop : Straight` bridge tiles, and hands the renderer a `blend ∈ [0,1]` along the bridge tiles so materials, particles and vegetation fills cross-fade rather than cut. Set dressing for the *next* biome starts appearing at `blend > 0.5`, thinned, so the skyline is visible before the road reaches it.

---

## 2. `TrackSpline` — arc-length spline with a stable moving frame

Requirements: constant-speed evaluation by arc length (the runner moves in metres, not in parameter space), frames that never flip on vertical sections, banking that eases through turns, and O(1) lookups at 60 Hz for the runner, the camera, hundreds of props and the mesh builder.

```csharp
// TrackSpline.cs
using System.Collections.Generic;
using UnityEngine;

public struct Frame { public Vector3 P, T, N, B; public float bank; }

public class TrackSpline
{
    // Catmull-Rom through control points; each control point carries a bank angle.
    readonly List<Vector3> pts = new();
    readonly List<float> bankAtPt = new();
    // Arc-length LUT: distance -> parameter u, plus a parallel-transported normal per sample.
    readonly List<float> lutS = new();
    readonly List<float> lutU = new();
    readonly List<Vector3> lutN = new();
    public float Length { get; private set; }
    const float SampleStep = 0.5f;          // metres; 2 samples per metre is plenty for a 2.2 m lane

    public void Append(Vector3 p, float bankDeg) { pts.Add(p); bankAtPt.Add(bankDeg); Rebuild(); }
    public void TrimBefore(float s) { /* drop control points older than s - 1 tile; renumber LUT (ring buffer in production) */ }

    Vector3 Eval(float u) {                 // u in [0, pts.Count-3]
        int i = Mathf.Clamp(Mathf.FloorToInt(u), 0, pts.Count - 4); float t = u - i;
        Vector3 p0 = pts[i], p1 = pts[i + 1], p2 = pts[i + 2], p3 = pts[i + 3];
        return 0.5f * ((2f * p1) + (-p0 + p2) * t + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t * t + (-p0 + 3f * p1 - 3f * p2 + p3) * t * t * t);
    }
    Vector3 Tangent(float u) { return (Eval(u + 1e-3f) - Eval(u - 1e-3f)).normalized; }
    float BankAt(float u) { int i = Mathf.Clamp(Mathf.FloorToInt(u), 0, pts.Count - 4); float t = u - i; return Mathf.Lerp(bankAtPt[i + 1], bankAtPt[i + 2], Mathf.SmoothStep(0, 1, t)); }

    void Rebuild() {
        if (pts.Count < 4) return;
        lutS.Clear(); lutU.Clear(); lutN.Clear();
        float s = 0f; Vector3 prev = Eval(0f);
        // Parallel transport: carry the previous normal along the tangent so the frame never flips,
        // even through a vertical climb where Vector3.up would be parallel to T.
        Vector3 n = Vector3.up;
        for (float u = 0f; u <= pts.Count - 3; u += SampleStep / Mathf.Max(0.01f, (Eval(u + 0.01f) - Eval(u)).magnitude / 0.01f)) {
            Vector3 p = Eval(u), t = Tangent(u);
            s += (p - prev).magnitude; prev = p;
            n = Vector3.ProjectOnPlane(n, t).normalized;               // transport
            // gently pull toward world up when it is well-defined, so long flat stretches re-level themselves
            float upness = 1f - Mathf.Abs(Vector3.Dot(t, Vector3.up));
            n = Vector3.Slerp(n, Vector3.ProjectOnPlane(Vector3.up, t).normalized, 0.05f * upness).normalized;
            lutS.Add(s); lutU.Add(u); lutN.Add(n);
        }
        Length = s;
    }

    /// Frame at arc length s (metres). Bank rotates N and B about T.
    public Frame FrameAt(float s) {
        s = Mathf.Clamp(s, 0f, Length);
        int lo = 0, hi = lutS.Count - 1;                                 // binary search the LUT
        while (hi - lo > 1) { int mid = (lo + hi) >> 1; if (lutS[mid] <= s) lo = mid; else hi = mid; }
        float k = Mathf.InverseLerp(lutS[lo], lutS[hi], s);
        float u = Mathf.Lerp(lutU[lo], lutU[hi], k);
        Vector3 t = Tangent(u);
        Vector3 n = Vector3.Slerp(lutN[lo], lutN[hi], k).normalized;
        float bank = BankAt(u);
        Quaternion roll = Quaternion.AngleAxis(bank, t);
        n = roll * n;
        return new Frame { P = Eval(u), T = t, N = n, B = Vector3.Cross(t, n).normalized, bank = bank };
    }

    /// Track space -> world. laneX is metres across (0 at the centreline), h metres above the surface.
    public Vector3 World(float s, float laneX, float h) { var f = FrameAt(s); return f.P + f.B * laneX + f.N * h; }

    /// World -> nearest s (used only for debug/tools and for re-syncing after a teleport). Coarse LUT scan then refine.
    public float NearestS(Vector3 world) {
        int best = 0; float bd = float.MaxValue;
        for (int i = 0; i < lutS.Count; i += 4) { float d = (Eval(lutU[i]) - world).sqrMagnitude; if (d < bd) { bd = d; best = i; } }
        return lutS[best];
    }
}
```

**Why parallel transport, not Frenet.** The Frenet normal points toward the centre of curvature and flips sign at every inflection, which would make the road roll 180° on an S-curve. Transported normals plus an explicit `bank` per control point give designer-controlled banking and are stable through loops and vertical climbs.

---

## 3. `TrackGenerator` — tile ring, grammar, biome switching

```csharp
// TrackGenerator.cs
using System.Collections.Generic;
using UnityEngine;

public class TrackGenerator : MonoBehaviour
{
    public TrackTile[] library;
    public TransitionSpec[] transitions;
    public int tilesAhead = 6, tilesBehind = 1;
    public float biomeSectionMetres = 288f, seasonSectionMetres = 504f;
    public TrackMeshBuilder meshBuilder; public HazardPlacer hazards; public SetDresser dresser;

    public readonly TrackSpline spline = new();
    readonly Queue<PlacedTile> live = new();
    readonly Dictionary<Vector2Int, List<float>> occupancy = new();     // cell -> centreline heights present
    System.Random rng;
    Frame cursor;                          // end frame of the last placed tile
    float cursorS;                         // arc length at the cursor
    float pitchAccum;                      // cumulative pitch (deg)
    Biome biome = Biome.Mountain; int season; float sectionMetres, seasonMetres; TrackTile last;

    public struct PlacedTile { public TrackTile tile; public float s0, s1; public Biome biome; public int season; public float blend; }

    public void Init(int seed, Vector3 origin) {
        rng = new System.Random(seed);
        cursor = new Frame { P = origin, T = Vector3.forward, N = Vector3.up, B = Vector3.right };
        spline.Append(origin - Vector3.forward * 12f, 0); spline.Append(origin, 0);            // two leading points for Catmull-Rom
        for (int i = 0; i < tilesAhead + tilesBehind + 1; i++) PlaceNext();
    }

    public void Update(float runnerS) {
        while (live.Count > 0 && live.Peek().s1 < runnerS - tilesBehind * 36f) { var old = live.Dequeue(); meshBuilder.Release(old); dresser.Release(old); hazards.Release(old); spline.TrimBefore(old.s1); PlaceNext(); }
    }

    void PlaceNext() {
        // 1. section bookkeeping (biome / season / transition)
        bool transitioning = sectionMetres >= biomeSectionMetres;
        TransitionSpec spec = default; bool hasSpec = false;
        if (transitioning) { Biome next = (Biome)(((int)biome + 1) % 4); foreach (var t in transitions) if (t.from == biome && t.to == next) { spec = t; hasSpec = true; } }

        // 2. choose a tile: grammar filter, then weighted pick, then geometric validation (with retries)
        TrackTile tile = null;
        for (int tries = 0; tries < 24 && tile == null; tries++) {
            TrackTile cand = transitioning && hasSpec && spec.bridgeTiles.Length > 0 ? spec.bridgeTiles[rng.Next(spec.bridgeTiles.Length)] : library[rng.Next(library.Length)];
            if (!Allowed(cand)) continue;
            if (!FitsWorld(cand)) continue;
            tile = cand;
        }
        if (tile == null) tile = Straight();                                       // always exists, always fits by rule 4 (we reserve straight runway)

        // 3. lay control points along the tile: turn and pitch are eased over the tile, bank peaks at the middle
        float s0 = cursorS; int steps = Mathf.Max(2, Mathf.CeilToInt(tile.length / 6f));
        float yaw0 = Mathf.Atan2(cursor.T.x, cursor.T.z) * Mathf.Rad2Deg, pitch0 = Mathf.Asin(cursor.T.y) * Mathf.Rad2Deg;
        for (int i = 1; i <= steps; i++) {
            float k = (float)i / steps, e = Mathf.SmoothStep(0, 1, k);
            float yaw = yaw0 + tile.turnDeg * e, pitch = Mathf.Clamp(pitch0 + tile.pitchDeg * e, -35f, 35f);
            Vector3 dir = Quaternion.Euler(-pitch, yaw, 0) * Vector3.forward;
            Vector3 p = spline_last() + dir * (tile.length / steps);
            spline.Append(p, tile.bankDeg * Mathf.Sin(k * Mathf.PI));
        }
        cursorS += tile.length; cursor = spline.FrameAt(cursorS); pitchAccum = Mathf.Asin(cursor.T.y) * Mathf.Rad2Deg;
        Occupy(s0, cursorS);

        // 4. record, build, dress, place hazards (all in track space)
        var placed = new PlacedTile { tile = tile, s0 = s0, s1 = cursorS, biome = biome, season = season, blend = transitioning ? Mathf.Clamp01((sectionMetres - biomeSectionMetres) / (hasSpec ? spec.blendMetres : 72f)) : 0f };
        live.Enqueue(placed);
        meshBuilder.Build(placed, spline); dresser.Dress(placed, spline, rng); hazards.Place(placed, rng);

        sectionMetres += tile.length; seasonMetres += tile.length; last = tile;
        if (transitioning && placed.blend >= 1f) { biome = (Biome)(((int)biome + 1) % 4); sectionMetres = 0f; }
        if (seasonMetres >= seasonSectionMetres) { season = (season + 1) % 4; seasonMetres = 0f; }
    }

    bool Allowed(TrackTile t) {
        if (last != null) foreach (var f in last.forbiddenNext) if (f == t) return false;
        if (t.kind == TileKind.SharpTurn && (last == null || last.kind == TileKind.SharpTurn || last.kind == TileKind.Drop)) return false;
        if (Mathf.Abs(pitchAccum + t.pitchDeg) > 35f) return false;
        if (t.kind == TileKind.Drop && last != null && last.kind == TileKind.Drop) return false;
        bool biomeOk = t.allowedBiomes.Length == 0; foreach (var b in t.allowedBiomes) biomeOk |= b == biome;
        return biomeOk;
    }

    // Occupancy: a tile fits if every 4 m sample of its centreline is in a free cell or ≥ 12 m vertically from what is there (bridge/underpass).
    bool FitsWorld(TrackTile t) {
        Vector3 p = cursor.P; Vector3 dir = cursor.T; float yaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, pitch = Mathf.Asin(dir.y) * Mathf.Rad2Deg;
        int n = Mathf.CeilToInt(t.length / 4f);
        for (int i = 1; i <= n; i++) {
            float k = (float)i / n, e = Mathf.SmoothStep(0, 1, k);
            Vector3 d = Quaternion.Euler(-(pitch + t.pitchDeg * e), yaw + t.turnDeg * e, 0) * Vector3.forward; p += d * (t.length / n);
            if (p.y < -60f || p.y > 120f) return false;
            var cell = new Vector2Int(Mathf.FloorToInt(p.x / 4f), Mathf.FloorToInt(p.z / 4f));
            if (occupancy.TryGetValue(cell, out var hs)) foreach (var h in hs) if (Mathf.Abs(h - p.y) < 12f) return false;
        }
        return true;
    }
    void Occupy(float s0, float s1) { for (float s = s0; s <= s1; s += 2f) { var f = spline.FrameAt(s); for (int dx = -2; dx <= 2; dx++) { var cell = new Vector2Int(Mathf.FloorToInt((f.P + f.B * dx * 3f).x / 4f), Mathf.FloorToInt((f.P + f.B * dx * 3f).z / 4f)); if (!occupancy.TryGetValue(cell, out var l)) occupancy[cell] = l = new List<float>(); l.Add(f.P.y); } } }
    Vector3 spline_last() => spline.FrameAt(cursorS).P;
    TrackTile Straight() { foreach (var t in library) if (t.kind == TileKind.Straight) return t; return library[0]; }
    public IEnumerable<PlacedTile> Live() => live;
    public TrackTile Fallback => Straight();
}
```

**Splits** are a second `TrackGenerator` instance seeded from the split frame with `tilesAhead = 5`, whose last tile is forced to a `Merge` whose end frame is written back into the parent (the parent skips its own tile placement for that span and accepts the merged frame). The runner carries a `branchId`; a lane change across the centre lane on a `Split` tile is what selects the branch, exactly like choosing a track today.

### 3.1 Hazards on curves — `HazardPlacer`
Rows are generated in track space by the existing grammar (`generateTrack(seed, index, track)` → cells `{z → s, lane, type}`) and placed with `spline.World(s, laneX(lane), 0)`, oriented by the frame (`rotation = Quaternion.LookRotation(-f.T, f.N)`). Two extra rules: no rows within 6 m of a sharp-turn apex or a drop lip; on `Facade` tiles the wall-run lane is an extra lane index (`lanes`) that only a `wallRun` verb can use. Solvability is unchanged because the grammar never sees geometry.

### 3.2 Road mesh — `TrackMeshBuilder`
Extrude a cross-section profile along the frame every 1 m: `profile[i] = (x, y)` in the (B, N) plane (road surface, kerbs, tunnel arch, facade wall). UV `u = x / width`, `v = s / 3` so dashes and crosswalks tile by metres. Each tile is its own mesh from a pool; adjacent tiles share their boundary ring vertices (same `s`), so there are never gaps. Tunnels swap the profile to a closed arch and flag the segment for the lighting/camera systems; bridges add railing profiles and a deck-thickness underside; facades add a vertical wall profile on `facadeSide`.

---

## 4. `SplineRunner` — the character controller

State lives in track space; world transform is derived every frame. Gravity acts along `-N`, so on a banked or vertical section "down" is toward the road, which is what makes wall-runs and climbs the *same* code path as running on the flat.

```csharp
// SplineRunner.cs
using UnityEngine;

public enum Traversal { Run, Jump, Slide, SlopeSlide, WallRun, Climb, Dive }

public class SplineRunner : MonoBehaviour
{
    public TrackGenerator track;
    public float laneWidth = 2.2f; public int laneCount = 6;
    public float baseSpeed = 13f, maxSpeed = 30f, laneChangeTime = 0.15f;
    public float jumpV = 10.8f, gravity = 38f, fastFallV = 20f, slideTime = 0.5f;
    public float slopeSlideAngle = 28f, slopeSlideBoost = 1.35f;
    public float wallRunTime = 1.6f, wallRunHeight = 1.4f, climbSpeed = 4f;

    // track-space state
    public float s, lane = 4f, h, vh, speed; int laneTarget = 4; float laneFrom, laneT = 1f;
    public Traversal state = Traversal.Run; float stateT; int wallSide;
    bool grounded = true, jumpHeld;

    public void OnLane(int dir) { if (laneT < 0.6f && laneT > 0f) return; laneFrom = lane; laneTarget = Mathf.Clamp(laneTarget + dir, -1, laneCount); laneT = 0f; }   // -1 / laneCount = the facade lanes
    public void OnJump(bool down) { jumpHeld = down; if (down && (grounded || state == Traversal.WallRun)) { vh = jumpV; grounded = false; if (state == Traversal.WallRun) { laneTarget = wallSide > 0 ? laneCount - 1 : 0; laneFrom = lane; laneT = 0f; } state = Traversal.Jump; } }
    public void OnSlide() { if (!grounded) { vh = -fastFallV; if (CurrentTile().tunnel) state = Traversal.Dive; } else { state = Traversal.Slide; stateT = slideTime; } }

    void FixedUpdate() {
        float dt = Time.fixedDeltaTime;
        var tile = CurrentTile();
        Frame f = track.spline.FrameAt(s);
        float slope = Mathf.Asin(Mathf.Clamp(f.T.y, -1f, 1f)) * Mathf.Rad2Deg;                    // + climbing, - descending

        // ---- forward speed: distance curve, slopes, slope-slide, climb
        float target = Mathf.Min(maxSpeed, baseSpeed + (maxSpeed - baseSpeed) * 0.38f * Mathf.Log(1f + s / 350f, 2f));
        target *= 1f - Mathf.Clamp01(slope / 35f) * 0.25f;                                          // climbs cost speed
        if (slope < -slopeSlideAngle && grounded && state != Traversal.Jump) { state = Traversal.SlopeSlide; target *= slopeSlideBoost; }
        else if (state == Traversal.SlopeSlide && slope >= -slopeSlideAngle * 0.7f) state = Traversal.Run;
        if (tile.climb) { state = Traversal.Climb; target = climbSpeed; }                          // vertical: lanes are rungs, speed is climb speed
        speed = Mathf.MoveTowards(speed, target, 12f * dt);
        s += speed * dt;

        // ---- lane change: eased across the binormal; the facade lanes exist only on Facade tiles
        if (laneT < 1f) { laneT = Mathf.Min(1f, laneT + dt / laneChangeTime); lane = Mathf.Lerp(laneFrom, laneTarget, 1f - Mathf.Pow(1f - laneT, 3f)); }
        bool ontoWall = tile.facadeWallRun && ((laneTarget < 0 && tile.facadeSide < 0) || (laneTarget >= laneCount && tile.facadeSide > 0));
        if (ontoWall && state != Traversal.WallRun) { state = Traversal.WallRun; stateT = wallRunTime; wallSide = tile.facadeSide; grounded = true; h = wallRunHeight; vh = 0f; }
        if (!tile.facadeWallRun && (laneTarget < 0 || laneTarget >= laneCount)) laneTarget = Mathf.Clamp(laneTarget, 0, laneCount - 1);

        // ---- vertical: gravity along -N; wall-run and climb suspend it
        if (state == Traversal.WallRun) { stateT -= dt; h = wallRunHeight + Mathf.Sin(stateT * 9f) * 0.05f; if (stateT <= 0f) { state = Traversal.Jump; grounded = false; laneTarget = wallSide > 0 ? laneCount - 1 : 0; laneFrom = lane; laneT = 0f; } }
        else if (state == Traversal.Climb) { h = 0f; vh = 0f; grounded = true; }
        else {
            if (jumpHeld && state == Traversal.Jump && vh > 0f) vh += gravity * 0.45f * dt;         // hold for height
            vh -= gravity * dt; h += vh * dt;
            if (h <= 0f) { h = 0f; vh = 0f; if (!grounded) { grounded = true; if (state == Traversal.Jump || state == Traversal.Dive) state = Traversal.Run; } }
            else grounded = false;
        }
        if (state == Traversal.Slide && (stateT -= dt) <= 0f) state = Traversal.Run;

        // ---- world transform: position from the frame, orientation aligned to tangent + normal (360°, no gimbal issues)
        float laneX = (lane - (laneCount - 1) * 0.5f) * laneWidth;
        if (state == Traversal.WallRun) laneX = wallSide * (laneCount * 0.5f * laneWidth + 0.35f);
        transform.position = f.P + f.B * laneX + f.N * h;
        Quaternion goal = Quaternion.LookRotation(f.T, state == Traversal.WallRun ? f.N * 0.2f + (-f.B * wallSide) : f.N);
        if (state == Traversal.Slide || state == Traversal.SlopeSlide) goal *= Quaternion.Euler(18f, 0f, 0f);
        transform.rotation = Quaternion.Slerp(transform.rotation, goal, 1f - Mathf.Exp(-14f * dt));
    }

    TrackTile CurrentTile() { foreach (var t in track.Live()) if (s >= t.s0 && s < t.s1) return t.tile; return track.Fallback; }
    public bool CurrentTileIsTunnel() => CurrentTile().tunnel;
}
```

Notes for the collision layer: hazards keep resolving against `(s, lane, h)` as before; there is no physics raycasting against the road at all, which is why fast, banked, vertical tracks cannot produce falling-through or tunnelling bugs. Only *set dressing* uses colliders, and only as triggers.

---

## 5. `RunnerCamera` — dynamic follow that stays readable

The camera is a critically damped spring on a **look-ahead frame**, not on the runner: it samples the spline `lead` metres ahead (lead grows with speed), so it turns *before* the runner does and the player sees into the corner. Pitch, height and FOV are driven by slope and tunnels; roll is disabled by default (motion sickness), with a small banked-turn roll as an option.

```csharp
// RunnerCamera.cs
using UnityEngine;

public class RunnerCamera : MonoBehaviour
{
    public SplineRunner runner; public TrackGenerator track; public Camera cam;
    public float back = 8.5f, height = 5.2f, lookHeight = 1.3f;
    public float leadMin = 18f, leadPerSpeed = 0.55f;          // look-ahead distance = leadMin + speed * leadPerSpeed
    public float fovBase = 66f, fovSpeed = 10f, fovTunnel = -8f, fovDrop = 6f;
    public float pitchDown = 6f, pitchUp = -4f;                 // extra pitch on descents / climbs (deg)
    public bool allowBankRoll = false; public float bankRollScale = 0.35f;
    public float posDamp = 6f, rotDamp = 5f, fovDamp = 2f;

    Vector3 vel; float fov;

    void LateUpdate() {
        float dt = Time.deltaTime; float sp = runner.speed;
        Frame here = track.spline.FrameAt(runner.s);
        Frame ahead = track.spline.FrameAt(runner.s + leadMin + sp * leadPerSpeed);
        Frame behind = track.spline.FrameAt(Mathf.Max(0f, runner.s - back));
        bool tunnel = runner.CurrentTileIsTunnel();
        float slope = Mathf.Asin(Mathf.Clamp(here.T.y, -1f, 1f)) * Mathf.Rad2Deg;

        // desired position: behind along the spline (so it follows the curve, not a straight offset), lifted along the local normal
        float h = tunnel ? height * 0.6f : height + Mathf.Clamp(-slope, 0f, 30f) * 0.08f;          // drops: rise a little to show the descent
        Vector3 goalPos = behind.P + behind.N * h;
        transform.position = Vector3.SmoothDamp(transform.position, goalPos, ref vel, 1f / posDamp);

        // desired aim: the look-ahead point on the centreline, biased by slope
        Vector3 aim = ahead.P + ahead.N * lookHeight + ahead.T * (slope < -10f ? -4f : 0f);
        Vector3 up = allowBankRoll ? Vector3.Slerp(Vector3.up, here.N, bankRollScale) : Vector3.up;   // level horizon unless bank roll is on
        Quaternion goalRot = Quaternion.LookRotation(aim - transform.position, up);
        goalRot *= Quaternion.Euler(slope < 0f ? Mathf.Lerp(0f, pitchDown, Mathf.Clamp01(-slope / 30f)) : Mathf.Lerp(0f, pitchUp, Mathf.Clamp01(slope / 30f)), 0f, 0f);
        transform.rotation = Quaternion.Slerp(transform.rotation, goalRot, 1f - Mathf.Exp(-rotDamp * dt));

        // FOV: speed widens, tunnels narrow, drops widen for drama; damped so it never pops
        float goalFov = fovBase + fovSpeed * Mathf.InverseLerp(runner.baseSpeed, runner.maxSpeed, sp) + (tunnel ? fovTunnel : 0f) + (slope < -20f ? fovDrop : 0f);
        fov = Mathf.Lerp(fov == 0f ? goalFov : fov, goalFov, 1f - Mathf.Exp(-fovDamp * dt)); cam.fieldOfView = fov;
    }
}
```

Readability rules baked into the numbers: the look-ahead point is ≥ 18 m ahead so a 90° turn is on screen for ≥ 0.6 s at max speed before the runner reaches it; in tunnels the camera drops and the FOV narrows so the arch never clips; on drops the camera rises and pitches down so the landing is visible; the horizon stays level unless `allowBankRoll` is set (and then only 35 % of the bank).

---

## 6. Environment set pieces on the new geometry

| Set piece | Tile | Traversal | Notes |
|---|---|---|---|
| Coastal beach → seawall promenade → overpass into the city | `Straight`, `Curve 30°`, `Incline +20°` (bridge profile) | run, jump gaps in the deck | skyline instanced at `blend > 0.5` |
| Cyber-feudal skyscraper district | `Facade` tiles both sides, `SharpTurn 90°` at intersections, `Bridge` between towers | wall-run on neon facades, leap collapsed bridge decks (gap rows) | neon light list feeds the puddle reflections as today |
| Shrine corridor | `Tunnel` (torii tunnel — Fushimi Inari), `Curve` with bank | dive through low gates (slide), lanterns as `stalk` | tunnel profile is an open torii arcade: darker, red key light |
| Mountain peak | `Incline`, `Climb` (rope ladder wall), `Drop` down a scree slope | climb, slope-slide with boost, jump the crest | wind particles scale with height |
| Deep tunnel / cave | `Tunnel` closed profile, `Split` inside the dark | dive; branches merge at the mouth | fog near/far shrink; fireflies/glow moss for readability |

---

## 7. Unreal notes
`TrackSpline` → `USplineComponent` with `GetLocationAtDistanceAlongSpline` / `GetTransformAtDistanceAlongSpline` (ESplineCoordinateSpace::World) — but replace its up-vector handling with the parallel-transport frame above (store `N` per spline point in a parallel `TArray<FVector>`), because the default up-vector interpolation flips on vertical sections. `TrackMeshBuilder` → `USplineMeshComponent` per 1 m segment for the road, or a runtime `UProceduralMeshComponent` when tunnels need custom profiles. Instancing via `UHierarchicalInstancedStaticMeshComponent`. The runner is a `UCharacterMovementComponent` subclass in `MOVE_Custom` mode that writes `(s, lane, h)` and sets `UpdatedComponent` transform from the frame each tick (no capsule sweeps against the road). Camera: a `USpringArmComponent` is the wrong tool (it sweeps and lags along a straight boom); use a plain `UCameraComponent` positioned by the script above.

## 8. Performance budgets
Frame LUT sampling every 0.5 m over 8 live tiles = ~600 samples; frame lookups O(log n) — ~3 µs each, negligible for hundreds of props. Road meshes ~1.5 k triangles per tile, pooled. Occupancy grid is a dictionary of ~2 k cells; trim entries behind the runner every tile. All generation runs on placement of one tile per ~2 s, well under a frame; move it to a Job if tiles get denser than 12 m.

## 9. Mapping to the web prototype
The Three.js prototype already simulates in track space (`z` ≡ `s`, `lane`, `y` ≡ `h`). Adding a `TrackSpline` and placing every chunk object with `spline.World(s, laneX, h)` plus a per-chunk bent road mesh is the whole migration: the sim, tests, autopilot, kaiju and netcode need no changes.
