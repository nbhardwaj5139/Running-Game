// Deterministic lockstep for co-op: two laptops, ONE shared World.
//
// The sim is pure — no Math.random, no clocks, chunks generated from (seed, index)
// — so two machines fed the same inputs at the same ticks reach byte-identical
// states. That means co-op needs no state sync at all: only inputs cross the wire.
//
// An input pressed on tick T is scheduled to run on tick T + DELAY on BOTH
// machines, and neither machine steps past a tick until it knows the other's
// inputs for that tick. So the two worlds cannot drift apart: they are the same
// simulation, run twice. The cost is DELAY ticks of input latency (100 ms), which
// is well under the round trip on a LAN and imperceptible while running.
//
// The promise on the wire is `upTo`: "I have sent every input I will ever have
// for ticks <= upTo". Because a local input always lands at tick + DELAY, the
// promise a machine can make at tick T is T + DELAY - 1.

export const COOP_DELAY = 6;            // ticks of input delay (100 ms at 60 Hz)

export class Lockstep {
  /**
   * @param world the shared World
   * @param slot  which runner this machine drives
   * @param peers the other slots on this road. With more than two machines the promise
   *   that matters is the SLOWEST one: a tick may only run once every peer has said it
   *   has no more inputs for it, so `ready` takes the minimum over all of them.
   */
  constructor(world, slot, delay = COOP_DELAY, peers = null) {
    this.world = world; this.slot = slot; this.delay = delay;
    this.pending = new Map();               // tick -> [{t, slot, seq, evt}]
    this.upTo = new Map();                  // peer slot -> the tick it has promised to have covered
    for (const s of peers ?? [1 - slot]) if (s !== slot) this.upTo.set(s, delay - 1);   // enough to start
    this.seq = 0;
    this.outbox = [];
    this.stalled = 0;                       // ticks we wanted to run but could not
  }

  /** A machine left the road: stop waiting on it, or everyone else freezes forever. */
  drop(slot) { this.upTo.delete(slot); }
  /** What the peer has promised (the slowest of them, when there is more than one). */
  get remoteUpTo() { let m = Infinity; for (const v of this.upTo.values()) m = Math.min(m, v); return m === Infinity ? this.world.tick + this.delay : m; }

  _at(t) { let a = this.pending.get(t); if (!a) this.pending.set(t, a = []); return a; }

  /** Queue a local input. It runs `delay` ticks from now, on both machines. */
  local(evt) {
    const rec = { t: this.world.tick + this.delay, slot: this.slot, seq: this.seq++, evt };
    this._at(rec.t).push(rec); this.outbox.push(rec);
    return rec;
  }

  /** Take a peer batch: its inputs, and the tick it promises to have covered. */
  remote({ inputs = [], upTo = 0, slot = null } = {}) {
    let from = slot;
    for (const r of inputs) {
      if (r.slot === this.slot) continue;                 // never re-apply our own echo
      from ??= r.slot;
      if (r.t <= this.world.tick) continue;               // impossible if both honour `upTo`; ignore rather than desync
      this._at(r.t).push(r);
    }
    // An empty batch carries no slot of its own, but an empty batch is exactly how a
    // quiet peer keeps everyone moving — with a single peer there is no ambiguity.
    if (from === null && this.upTo.size === 1) from = [...this.upTo.keys()][0];
    if (from === null || from === this.slot) return;
    if (upTo > (this.upTo.get(from) ?? -1)) this.upTo.set(from, upTo | 0);
  }

  /** Everything to send now, plus the promise that comes with it. Call even with no inputs: the promise is what unblocks the peer. */
  drain() {
    const inputs = this.outbox; this.outbox = [];
    return { inputs, upTo: this.world.tick + this.delay - 1, slot: this.slot };
  }

  /** True while the peer's inputs for the next tick are known. */
  get ready() { return this.world.tick < this.remoteUpTo; }

  /** Advance exactly one tick: apply every input scheduled for it — in the same order on both machines — then step. */
  step() {
    const t = this.world.tick + 1;
    const q = this.pending.get(t);
    if (q) {
      q.sort((a, b) => a.slot - b.slot || a.seq - b.seq);   // total order, identical on both machines
      for (const r of q) this.world.input(r.slot, r.evt);
      this.pending.delete(t);
    }
    this.world.step();
  }

  /** Run as many ticks as the clock and the peer allow. Returns ticks run. */
  advance(maxSteps = 12) {
    let n = 0;
    while (n < maxSteps && this.ready) { this.step(); n++; }
    this.stalled = this.ready ? 0 : this.stalled + 1;
    return n;
  }
}
