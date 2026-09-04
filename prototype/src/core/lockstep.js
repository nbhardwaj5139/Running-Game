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
  /** @param world the shared World  @param slot which runner this machine drives (0 left, 1 right) */
  constructor(world, slot, delay = COOP_DELAY) {
    this.world = world; this.slot = slot; this.delay = delay;
    this.pending = new Map();               // tick -> [{t, slot, seq, evt}]
    this.remoteUpTo = delay - 1;            // what the peer has promised so far (enough to start)
    this.seq = 0;
    this.outbox = [];
    this.stalled = 0;                       // ticks we wanted to run but could not
  }

  _at(t) { let a = this.pending.get(t); if (!a) this.pending.set(t, a = []); return a; }

  /** Queue a local input. It runs `delay` ticks from now, on both machines. */
  local(evt) {
    const rec = { t: this.world.tick + this.delay, slot: this.slot, seq: this.seq++, evt };
    this._at(rec.t).push(rec); this.outbox.push(rec);
    return rec;
  }

  /** Take a peer batch: its inputs, and the tick it promises to have covered. */
  remote({ inputs = [], upTo = 0 } = {}) {
    for (const r of inputs) {
      if (r.slot === this.slot) continue;                 // never re-apply our own echo
      if (r.t <= this.world.tick) continue;               // impossible if both honour `upTo`; ignore rather than desync
      this._at(r.t).push(r);
    }
    if (upTo > this.remoteUpTo) this.remoteUpTo = upTo | 0;
  }

  /** Everything to send now, plus the promise that comes with it. Call even with no inputs: the promise is what unblocks the peer. */
  drain() {
    const inputs = this.outbox; this.outbox = [];
    return { inputs, upTo: this.world.tick + this.delay - 1 };
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
