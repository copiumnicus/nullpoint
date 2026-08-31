// What a pilot is, independent of any connection.
//
// A socket is a session; an account is the person. Everything worth keeping lives
// here so it can be captured on the way out, restored on the way back, and tested
// without a server or a file.

import { DEFAULT_HULL, sanitiseFit, slotsOf, HULLS } from './ships.js';
import { EQUIPMENT, emptyFit, reseat, sanitiseDrones, sanitiseRig, isCollector,
         MAX_DRONES } from './gear.js';
import { FORMATIONS, DEFAULT_FORMATION } from './formation.js';
import { sanitiseAmmo, sanitiseUsing, sanitiseArmed, ARMED_ALL,
         DEFAULT_AMMO, STARTING_AMMO } from './ammo.js';
import { sanitiseKits, sanitiseKit, DEFAULT_KIT } from './repair.js';
import { sanitiseDevices, sanitiseDevice, DEFAULT_DEVICE } from './devices.js';
import { sanitiseMods, HOME_PLOTS } from './research.js';
import { ARENA_MODULES } from './arena.js';
import { sanitiseKills } from './threats.js';
import { sanitiseUnlocked, bonusBays } from './quests.js';
import { MAPS, COMPANIES, isArena } from './maps.js';
import { MATERIALS } from './cargo.js';
import { bankPlaytime } from './playtime.js';
import { sanitiseView } from './viewport.js';

const CALLSIGNS = ['Vex', 'Harrow', 'Kite', 'Sable', 'Rook', 'Marlow', 'Quill', 'Ash', 'Bram',
  'Corvid', 'Dray', 'Fen', 'Grist', 'Halcyon', 'Iber', 'Jax', 'Kesh', 'Lund', 'Mire', 'Nox',
  'Orrin', 'Pike', 'Quarry', 'Rell', 'Stray', 'Thorn', 'Umber', 'Vale', 'Wrack', 'Yarrow'];

export const callsign = n => `${CALLSIGNS[n % CALLSIGNS.length]}-${1000 + (n * 7919) % 9000}`;

// Companies are handed out in rotation by account number, not by who is online,
// so the three sides stay even across restarts.
export const companyFor = n => Object.keys(COMPANIES)[n % Object.keys(COMPANIES).length];

export function newAccount(token, seq, now) {
  const co = companyFor(seq);
  const home = co + '1', base = MAPS[home].base;
  return {
    token, seq, co, name: callsign(seq),
    // one emitter in the rack, so a new pilot is armed rather than helpless
    hull: DEFAULT_HULL, fit: { ...emptyFit(), weapon: ['emitter1'] }, gear: {},
    hulls: [DEFAULT_HULL],                        // the ships you own, not just the one you fly
    formation: DEFAULT_FORMATION, formations: [DEFAULT_FORMATION],
    ammo: { ...STARTING_AMMO }, using: { ...DEFAULT_AMMO }, armed: { ...ARMED_ALL },
    kits: {}, kit: DEFAULT_KIT,
    devices: {}, device: DEFAULT_DEVICE, foldTo: null, lab: null, kills: {},
    unlocked: [],                                 // the quests you have finished — see shared/quests.js
    claims: [],                                   // the mining rocks you have freed
    berths: [],                                   // outposts you rent a bay at
    lastDock: null,                               // the hangar a wreck comes back to
    credits: 0, xp: 0, drones: [], rig: null, vault: {}, hold: {}, admin: false,
    played: 0,                                    // seconds actually flown, idle tail excluded
    view: null,                                   // the window they play in — advisory, see viewport.js
    mapId: home, x: base.x, y: base.y,
    created: now, seen: now,
  };
}

// Anything that reaches us from disk is untrusted: it was a JSON file a moment
// ago and may have been hand-edited. Everything is clamped or dropped.
// A research station off the disk.
//
// Four hazards, all of which a hand-edited or restored save can present:
//   - a plot off the end of the lattice, from a shrunk yard or an edit. Dropped to
//     null rather than clamped, because clamping every bad value to 0 stacks every
//     broken save on plot zero. The boot pass re-places a null.
//   - a mask naming modules that no longer exist. Masked off, so removing a module
//     cannot leave a lab paying for something the game has forgotten.
//   - `since` in the future — a clock skew or an edit, and with offline accrual
//     that is a credit printer. Clamped to now.
//   - `since` from the distant past. cappedSecs bounds what one login can bank.
export function sanitiseLab(lab, now = Date.now()) {
  if (!lab || typeof lab !== 'object') return null;
  const slot = Number.isFinite(+lab.slot) ? Math.floor(+lab.slot) : -1;
  const since = Number.isFinite(+lab.since) ? Math.floor(+lab.since) : now;
  return { slot: slot >= 0 && slot < HOME_PLOTS ? slot : null,
           mods: sanitiseMods(lab.mods),
           since: Math.min(now, since) };
}

export function sanitiseAccount(a, seq, now) {
  const co = COMPANIES[a?.co] ? a.co : companyFor(seq);
  const hull = HULLS[a?.hull] ? a.hull : DEFAULT_HULL;
  // A sector that is not in the table any more, or an instanced one that stopped
  // existing when the process did. An arena is deliberately not a key of MAPS, so
  // a pilot who was inside one when the server restarted lands here — and their
  // COORDINATES have to come home with them. Keeping the arena's x,y and only
  // swapping the sector put pilots down wherever they had been fighting, in their
  // own home ring, outside the dock. It is the same shape as the bug that put a
  // respawn at NaN: a position is only meaningful together with the map it is in.
  const known = !!MAPS[a?.mapId];
  const mapId = known ? a.mapId : co + '1';
  const stack = o => Object.fromEntries(Object.entries(o ?? {})
    .filter(([k, n]) => MATERIALS[k] && Number.isFinite(n) && n > 0)
    .map(([k, n]) => [k, Math.floor(n)]));
  const base = MAPS[co + '1'].base;
  const locker = o => Object.fromEntries(Object.entries(o ?? {})
    .filter(([k, n]) => EQUIPMENT[k] && Number.isFinite(n) && n > 0)
    .map(([k, n]) => [k, Math.floor(n)]));
  const forms = [...new Set([DEFAULT_FORMATION, ...(Array.isArray(a?.formations) ? a.formations : [])]
    .filter(f => FORMATIONS[f]))];
  const hulls = [...new Set([DEFAULT_HULL, ...(Array.isArray(a?.hulls) ? a.hulls : [])].filter(h => HULLS[h]))];
  const flying = hulls.includes(hull) ? hull : DEFAULT_HULL;
  // Whatever no longer fits comes back to the locker instead of evaporating.
  //
  // This read `sanitiseFit(flying, a?.fit)`, which silently DELETES the surplus,
  // and every login reads a save through here — so the day a hull's slot table
  // moved, everyone flying that hull quietly lost the difference, with nothing
  // said and nothing to say it to. This commit is that day: the Vanguard drops
  // from two technology bays to one, and a pilot with two fitted would have
  // signed back in owning one. reseat is the identical call the hangar's
  // hull-swap already makes. Cleaned afterwards because reseat hands back
  // whatever the fit named, and a hand-edited file can name anything.
  const seated = reseat(slotsOf(flying), a?.fit, locker(a?.gear));
  const gear = locker(seated.gear);
  // The FLEET cap, which is what a pilot may own rather than what their hull berths.
  // It has to rise with an earned berth or every login would silently delete the
  // drones the extra bays bought: sanitiseDrones slices at MAX_DRONES, a Kestrel
  // berths exactly MAX_DRONES, and the Brood Frame takes it to fourteen. Exactly the
  // bug the reseat() note above this line is about, one field over.
  const earned = sanitiseUnlocked(a?.unlocked);
  return {
    token: a.token, seq, co, name: typeof a?.name === 'string' ? a.name : callsign(seq),
    hull: flying, fit: seated.fit, gear, hulls,
    drones: sanitiseDrones(a?.drones, seated.fit, MAX_DRONES + bonusBays(earned), slotsOf(flying).tech),
    // Collectors used to live in a combat bay. Anyone who fitted one before this
    // keeps it — it moves into the rig bay rather than being dropped on the floor,
    // and sanitiseDrones has already refused to leave it in the rack.
    rig: sanitiseRig(a?.rig ?? (Array.isArray(a?.drones) ? a.drones.find(isCollector) : null)),
    xp: Number.isFinite(a?.xp) ? Math.max(0, Math.floor(a.xp)) : 0,
    admin: a?.admin === true,
    formations: forms, formation: forms.includes(a?.formation) ? a.formation : DEFAULT_FORMATION,
    ammo: sanitiseAmmo(a?.ammo), using: sanitiseUsing(a?.using), armed: sanitiseArmed(a?.armed),
    kits: sanitiseKits(a?.kits), kit: sanitiseKit(a?.kit),
    devices: sanitiseDevices(a?.devices), device: sanitiseDevice(a?.device),
    // Where a beacon puts you. Not checked here: a bay can be sold and a sector
    // can stop having an outpost, so it is re-checked against homePorts at the
    // moment of use rather than trusted from disk.
    foldTo: typeof a?.foldTo === 'string' ? a.foldTo : null,
    lab: sanitiseLab(a?.lab, now),
    // What this pilot has killed, and therefore what their threat file holds.
    kills: sanitiseKills(a?.kills),
    // And what those kills have already bought. Deliberately NOT re-derived from
    // `kills` on the way in: a threshold that moved would then confiscate a reward
    // somebody had already earned, and sanitiseKills drops retired hostiles, which
    // would take the trophy with the animal. shared/quests.js argues both.
    unlocked: earned,
    berths: [...new Set((Array.isArray(a?.berths) ? a.berths : []).filter(id => MAPS[id]?.outpost))],
    // Which claim fights this pilot has won. Membership of a fixed list, so a
    // hand-edited save cannot name a rock that does not exist, and a retired
    // mining tier drops out cleanly rather than leaving a claim on nothing.
    claims: [...new Set((Array.isArray(a?.claims) ? a.claims : []).filter(k => ARENA_MODULES.includes(k)))],
    lastDock: MAPS[a?.lastDock] ? a.lastDock : null,
    credits: Number.isFinite(a?.credits) ? Math.max(0, Math.floor(a.credits)) : 0,
    played: Number.isFinite(a?.played) ? Math.max(0, Math.floor(a.played)) : 0,
    // What window they play in. Advisory only — see viewport.js for why nothing in
    // the simulation may read it — and it deliberately outlives a /reset: a pilot
    // who threw their progress away still has the same monitor in front of them.
    view: sanitiseView(a?.view, now),
    vault: stack(a?.vault), hold: stack(a?.hold),
    mapId,
    x: known && Number.isFinite(a?.x) ? a.x : base.x,
    y: known && Number.isFinite(a?.y) ? a.y : base.y,
    created: a?.created ?? now, seen: now,
  };
}

// Unfold an account into the live fields a player carries. The exact inverse of
// capture() below, and it exists because the list was written out twice: once
// where a connection seeds a player, and once inside /reset, by hand.
//
// The hand-written one had already fallen behind. /reset built a fresh account —
// which correctly has no research station — assigned it, then zeroed credits, gear,
// hulls, ammunition and the hold field by field and never touched `lab`, `kills`,
// `berths`, `devices` or `foldTo`. So the live player kept a 500,000cr station and
// a x4 hull multiplier, capture() wrote all of it straight back onto the new
// account a second later, and a pilot who reset came out with nothing but the
// research ladder of the pilot they had just thrown away. It said "a starter hull,
// no credits, and your own dock again" while doing none of that.
//
// One list now. Both callers take it, so a field added to an account cannot be
// missed by the reset, and test/account.mjs fails BY NAME if capture() learns to
// write something this does not hand back.
//
// SHIP_FIELDS below is the seam: those are the account fields that live on the
// ship rather than on the player, so they are restored by refit() rather than here.
export const SHIP_FIELDS = ['hull', 'fit', 'drones', 'rig', 'formation'];

export function carried(a) {
  return {
    credits: a.credits, xp: a.xp,
    gear: { ...a.gear }, hulls: [...a.hulls], formations: [...a.formations],
    ammo: { ...a.ammo }, using: { ...a.using }, armed: { ...a.armed },
    kits: { ...a.kits }, kit: a.kit,
    devices: { ...a.devices }, device: a.device,
    foldTo: a.foldTo ?? null, lab: a.lab ?? null,
    kills: { ...(a.kills ?? {}) },
    unlocked: [...(a.unlocked ?? [])],
    berths: [...(a.berths ?? [])], lastDock: a.lastDock ?? null,
    claims: [...(a.claims ?? [])],
    vault: { ...a.vault }, hold: { ...a.hold },
    // The window they play in, which /reset deliberately hands straight back —
    // it is a fact about their hardware, not about their progress. The reset path
    // carries it across to the fresh account for that reason; everything else in
    // this list comes back empty from a new one.
    view: a.view ?? null,
  };
}

// Fold a live player back into their account, ready to be written out.
export function capture(account, p, now) {
  account.co = p.co;
  account.hull = p.ship.hull;
  account.fit = sanitiseFit(p.ship.hull, p.ship.fit);
  account.gear = { ...p.gear };
  account.hulls = [...p.hulls];
  account.drones = [...p.ship.drones];
  account.rig = p.ship.rig ?? null;
  bankPlaytime(account, p, now);
  account.formation = p.ship.formation;
  account.formations = [...p.formations];
  account.ammo = { ...p.ammo };
  account.using = { ...p.using };
  account.armed = { ...p.armed };
  account.kits = { ...p.kits };
  account.devices = { ...p.devices };
  account.kit = p.kit;
  account.device = p.device;
  account.foldTo = p.foldTo ?? null;
  account.lab = p.lab ?? null;
  account.kills = { ...p.kills };
  account.unlocked = [...(p.unlocked ?? [])];   // a player built before quests existed has none
  account.berths = [...(p.berths ?? [])];   // a player built before berths existed has none
  account.claims = [...(p.claims ?? [])];
  account.lastDock = p.lastDock ?? null;
  account.xp = p.xp;
  account.credits = p.credits;
  account.vault = { ...p.vault };
  account.hold = { ...p.hold };
  account.view = p.view ?? null;
  // Where they were, and an instanced sector is not a where. An arena stops
  // existing with the process that made it, so writing one down writes a
  // destination that will not be there — and the pilot comes back to it. The
  // account keeps saying the last REAL place they stood, which is where they
  // launched the claim from. sanitiseAccount catches this a second time on the way
  // in off disk, because a save file may predate this line.
  if (!isArena(p.mapId)) {
    account.mapId = p.mapId;
    account.x = Math.round(p.ship.x);
    account.y = Math.round(p.ship.y);
  }
  account.seen = now;
  return account;
}
