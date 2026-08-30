// Delta-state encoding for the per-tick snapshot.
//
// Measured first, on a real server with real sockets: twenty pilots in one
// sector cost 75.0 KiB/s EACH — 1.46 MiB/s off one box — and 82% of that was the
// ship list. Twenty-six rows of twenty-eight fields, resent thirty times a
// second whether or not one number in them had moved. A pilot sitting still at
// the dock re-transmitted their entire row 30 times a second, forever. Alone in
// a sector the split inverts: ships are 26% and the per-viewer scalars — the
// ammunition counts, the loadout, the power levels, the rank — are the other
// 74%, and those change perhaps once a minute.
//
// So both halves are diffed, and both are diffed generically. There is no
// per-stream codec: a keyed collection of positional rows is declared in
// `net.js` and gets add/update/remove for free. Adding a stream is a line of
// data there, not an encoder here.
//
// THE BASELINE IS PER CONNECTION, NEVER PER MAP. Radar means two pilots in the
// same sector legitimately see different things, and an enemy you have not
// detected must not reach the wire at all — so there is no shared "world last
// tick" to diff against. Every viewer carries its own copy of what it was last
// told, and that is the only thing the delta is relative to.

import { STREAMS, EPHEMERAL, bagKeys } from './net.js';

// A row is only ever updated in place, so a field index and its mask bit must
// line up exactly. They are the same number on purpose: an off-by-one between
// them is precisely the transposition net.js exists to prevent, and it would be
// silent — the client would just read `hp` out of the `sh` slot.
//
// Bitwise operators in JavaScript are 32-bit and SIGNED, so `1 << 31` is
// negative and `1 << 32` wraps around to 1. A 32nd field would therefore corrupt
// every update in a way no test of the 31 below would notice. SHIP_FIELDS is
// already at 30, so there is exactly one slot left.
export const MAX_FIELDS = 31;

// What a connection remembers having been told. `map` is on it because a jump
// replaces the visible set wholesale — see needsFull.
//
// `bag` holds the per-viewer scalars, and it holds different things at the two
// ends on purpose: on the server it holds the JSON TEXT of each field, because
// the only comparison that means anything is the one the wire makes, and on the
// client it holds the values themselves, because what the client has to do with
// them is hand them straight back. A given base only ever encodes or decodes,
// never both, so the two never meet.
export const newBase = () => ({ map: null, ready: false, rows: new Map(), bag: new Map() });

// A keyframe is owed when there is no baseline at all, or when the baseline was
// built for a sector the viewer has since left. The map check is here rather
// than at each of the six places server.js reassigns `mapId` because one of them
// would eventually be forgotten, and the symptom would be a client interpolating
// against ships in a sector it is no longer in.
export const needsFull = (base, mapId) => !base || base.map !== mapId;

const rowsFor = (base, name) => {
  let m = base.rows.get(name);
  if (!m) base.rows.set(name, m = new Map());
  return m;
};

// --- keyed collections -------------------------------------------------------

// [adds, updates, removes], with trailing empties trimmed off and null for "not
// one thing moved". At 30Hz the all-quiet case is the common one, and `[]` beats
// `[[],[],[]]` by six bytes a tick per stream.
//
// `updates` is FLAT — id, mask, then one value per set bit, then the next id —
// rather than an array per entity. The mask gives the length, so it is
// unambiguous, and it saves the two brackets per changed ship that would
// otherwise cost about 1.2 KiB/s per viewer in a crowded sector.
export function diffRows(spec, prev, next) {
  const { fields, key } = spec;
  const add = [], up = [], rem = [];
  for (const [id, row] of next) {
    const was = prev.get(id);
    if (!was) { add.push(row); continue; }
    let mask = 0;
    for (let i = 0; i < fields.length; i++) if (i !== key && row[i] !== was[i]) mask |= 1 << i;
    if (!mask) continue;
    up.push(id, mask);
    for (let i = 0; i < fields.length; i++) if (mask & (1 << i)) up.push(row[i]);
  }
  for (const id of prev.keys()) if (!next.has(id)) rem.push(id);
  const out = [add, up, rem];
  while (out.length && !out[out.length - 1].length) out.pop();
  return out.length ? out : null;
}

// The mirror, in place. Note that the value cursor advances for every set bit
// whether or not the row is there to receive it: bailing out early on a missing
// id would leave the cursor mid-entity and silently shred every update after it.
export function applyRows(spec, prev, d) {
  const { fields, key } = spec;
  if (!d) return prev;
  const add = d[0] ?? [], up = d[1] ?? [], rem = d[2] ?? [];
  for (const row of add) prev.set(row[key], row.slice());
  for (let i = 0; i < up.length; ) {
    const id = up[i++], mask = up[i++];
    const row = prev.get(id);
    for (let f = 0; f < fields.length; f++) {
      if (!(mask & (1 << f))) continue;
      const v = up[i++];
      if (row) row[f] = v;
    }
  }
  for (const id of rem) prev.delete(id);
  return prev;
}

// --- the per-viewer scalars --------------------------------------------------

// Credits, the loadout, the power levels, the rank: two dozen fields that are
// identical tick after tick and were 74% of a lone pilot's traffic. Compared as
// JSON rather than by identity, for two reasons: JSON is what actually goes on
// the wire, so if the text is the same the client cannot tell whatever the
// objects did — and the server hands over the SAME OBJECT every tick and mutates
// it in place. `hold`, `ammo`, `gear` and `vault` are the player's own records,
// so an identity check would report them unchanged forever and a pilot would
// scoop ore into a cargo bay that never updated.
//
// `undefined` and absent are the same thing here (the server writes
// `scoop: V.scoop ? {...} : undefined`), and a key that goes away is reported
// separately rather than as a null value, so a field whose real value is null
// can never be mistaken for a field that vanished.
export function diffBag(seen, next) {
  const set = {}, gone = [];
  let any = false;
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v === undefined) continue;
    const j = JSON.stringify(v);
    if (seen.get(k) === j) continue;
    seen.set(k, j); set[k] = v; any = true;
  }
  for (const k of [...seen.keys()]) {
    if (next[k] !== undefined) continue;
    seen.delete(k); gone.push(k); any = true;
  }
  return any ? { set, gone } : null;
}

// --- the message ------------------------------------------------------------
//
// Two shapes, and the client has exactly one reader for both. `t:'s'` is the
// keyframe and is byte-for-byte the message this game always sent: everything,
// right now. `t:'d'` is the tick-to-tick delta, and decoding it RETURNS a `t:'s'`
// — so a delta cannot drift away from a keyframe by growing its own reader.
// That was the whole shape of the last wire bug this file's neighbour exists to
// prevent.

const put = (msg, k, v) => { if (v !== undefined && v !== null) msg[k] = v; };

// Whole truth -> keyframe, and prime the baseline from it. Priming lives here,
// not at the call site, because a keyframe that forgets to prime makes the very
// next tick a delta against nothing.
export function encodeFull(base, mapId, rows, bag, extra) {
  base.map = mapId; base.ready = true;
  base.rows = new Map();
  base.bag = new Map();
  const msg = { t: 's' };
  for (const name of Object.keys(STREAMS)) {
    const src = rows[name] ?? new Map();
    base.rows.set(name, new Map([...src].map(([id, r]) => [id, r.slice()])));
    msg[name] = [...src.values()];
  }
  for (const k of Object.keys(bag)) {
    if (bag[k] === undefined) continue;
    base.bag.set(k, JSON.stringify(bag[k]));
    msg[k] = bag[k];
  }
  for (const name of EPHEMERAL) if (extra?.[name]?.length) msg[name] = extra[name];
  return msg;
}

// Whole truth -> delta against what this connection was last told.
export function encodeDelta(base, rows, bag, extra) {
  const msg = { t: 'd' };
  for (const [name, spec] of Object.entries(STREAMS)) {
    const mine = rowsFor(base, name);
    const d = diffRows(spec, mine, rows[name] ?? new Map());
    put(msg, spec.wire, d);
    // Advance the baseline by the delta rather than by the truth. Same result,
    // but it is the encoder eating its own output, so an encode/apply pair that
    // disagreed would show up here as drift within a second rather than as a
    // client bug nobody could reproduce.
    applyRows(spec, mine, d);
  }
  const b = diffBag(base.bag, bag);
  if (b) {
    if (Object.keys(b.set).length) msg.b = b.set;
    if (b.gone.length) msg.x = b.gone;
  }
  // Bolts, rockets, blasts and hits go whole, every tick, on purpose — see
  // EPHEMERAL in net.js for the measurement that says so. Omitted when empty,
  // which alone is 44 bytes a tick back.
  for (const name of EPHEMERAL) if (extra?.[name]?.length) msg[name] = extra[name];
  return msg;
}

// Client side. A keyframe replaces the baseline; a delta patches it. Either way
// what comes back out is a full snapshot in the shape the client already knows.
export function absorbFull(base, msg) {
  // `ready` is the client's half of the keyframe contract: a delta that arrives
  // before any keyframe has nothing to be relative to, so the client asks for one
  // and drops deltas until it comes. Over TCP this only happens on a reconnect
  // that lands mid-tick, but 'it cannot happen' is how a black screen ships.
  base.ready = true;
  base.rows = new Map();
  base.bag = new Map();
  for (const [name, spec] of Object.entries(STREAMS))
    base.rows.set(name, new Map((msg[name] ?? []).map(r => [r[spec.key], r.slice()])));
  for (const k of bagKeys(msg)) base.bag.set(k, msg[k]);
  return msg;
}

export function decodeDelta(base, msg) {
  for (const [name, spec] of Object.entries(STREAMS))
    applyRows(spec, rowsFor(base, name), msg[spec.wire]);
  if (msg.b) for (const k of Object.keys(msg.b)) base.bag.set(k, msg.b[k]);
  if (msg.x) for (const k of msg.x) base.bag.delete(k);
  const out = { t: 's' };
  for (const [k, v] of base.bag) out[k] = v;
  // Copies, not the baseline's own rows. Handing out the live ones is free until
  // something keeps a snapshot: the next tick writes through the reference and
  // every snapshot anybody held turns into the latest one. The live-wire
  // benchmark stored seventy-two ticks and every one of them read as the last.
  // A slice per visible ship is nothing beside the unpackShip the client does to
  // each of them one line later.
  for (const name of Object.keys(STREAMS))
    out[name] = [...rowsFor(base, name).values()].map(r => r.slice());
  for (const name of EPHEMERAL) out[name] = msg[name] ?? [];
  return out;
}
