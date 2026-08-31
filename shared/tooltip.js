// What a thing in the station actually does to YOUR ship.
//
// A blurb like "hard to track, and half blind" reads well and tells you nothing.
// These build the real numbers: every attribute the item moves, the value you
// have now, and the value you would have after. Computed by resolving the ship
// twice rather than by reading the mod list, so a change to how mods stack shows
// up here for free and can never quietly disagree with the ship you fly.
//
// A tip is also where a player finds out WHERE a thing is sold and WHY they
// cannot fit it yet. Those used to live only in the refusal you got after
// clicking, which meant the shop answered questions in the wrong order: it told
// you no, and only then told you what it was.

import { ATTRS, HULLS, resolve, slotsOf, baysOf } from './ships.js';
import { bonusBays } from './quests.js';
import { EQUIPMENT, dronePrice, topTier, frontierOnly, isCollector } from './gear.js';
import { FORMATIONS, BONUS_AT, escortScale } from './formation.js';
import { launcherRoom, launcherCap } from './rockets.js';
import { AMMO, NEEDS, bestTierFor } from './ammo.js';
import { KITS, KIT_QUIET } from './repair.js';
import { DEVICES } from './devices.js';
import { ABILITIES, attrAbility, VEIL_DEPTH, ANCHOR_SWELL, ANCHOR_DRAG,
         DRUMFIRE_GAIN, DRUMFIRE_REACH } from './ability.js';
import { SPENDS, PLATE_BACK, FOUNDRY_QUIET, SHEAR_GRACE, LOUD } from './tech.js';

const round = v => Math.abs(v) >= 100 ? Math.round(v)
                 : Math.abs(v) >= 10  ? Math.round(v * 10) / 10
                                      : Math.round(v * 100) / 100;

// Every note is drawn on one line in a box that stops at 340px, so about fifty
// characters is the whole budget. Longer than that and the sentence runs out of
// the frame — which is exactly the bug the wording was meant to fix.
export const TIP_COLS = 52;

// One line per attribute that moved, in the schema's own order so the important
// ones stay at the top and the list does not reshuffle between items.
export function diffLines(before, after) {
  return Object.keys(ATTRS).filter(k => Math.abs((after[k] ?? 0) - (before[k] ?? 0)) > 1e-6).map(k => {
    const from = before[k], to = after[k], up = to > from;
    return { key: k, label: ATTRS[k].label, unit: ATTRS[k].unit ?? '',
             from: round(from), to: round(to),
             pct: Math.abs(from) > 1e-9 ? Math.round(100 * (to / from - 1)) : null,
             good: (ATTRS[k].better === 'high') === up };
  });
}

// A single hand-built row, for the things that have no second ship to resolve —
// a crate of ammunition changes what a bolt lands, not what the ship is.
const line = (key, label, from, to, unit = '', good = true) => ({
  key, label, unit, from: round(from), to: round(to),
  pct: Math.abs(from) > 1e-9 ? Math.round(100 * (to / from - 1)) : null, good,
});

// What each hull's own system does, in numbers, taken from the constants that
// drive it rather than written out again here. A sentence that restates a
// constant is a sentence that will be wrong the first time the constant moves.
const abilityNote = key => {
  const ab = ABILITIES[key];
  if (!ab) return null;
  if (key === 'veil')   return `${ab.name}: seen at ${Math.round((1 - VEIL_DEPTH) * 100)}% range, until you fire`;
  if (key === 'anchor') return `${ab.name}: shields x${1 + ANCHOR_SWELL}, speed x${round(1 - ANCHOR_DRAG)}`;
  if (key === 'drumfire') return `${ab.name}: rate x${round(1 + DRUMFIRE_GAIN)}, range -${Math.round(DRUMFIRE_REACH * 100)}%`;
  return `${ab.name}: routed from the reactor, like the guns`;
};

// What a set of mods does, spelled out on one line for a shop row. Read off the
// table itself, so a rebalance can never leave the shelf describing last week's
// numbers — which is the whole reason the formations' own blurbs stopped quoting
// them.
export const modSummary = mods => (mods ?? [])
  .map(([attr, op, v]) => `${(ATTRS[attr]?.label ?? attr).toLowerCase()} `
     + (op === 'mul' ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
                     : `${v > 0 ? '+' : ''}${round(v)}`))
  .join(' \u00b7 ');

// Which hull's own system a module retunes, read off the attribute name rather
// than a list that would have to be kept in step with the shelf. An ability dial
// is only read by the hull that HAS that ability, so a Veil technology bolted to a
// Bulwark is a purchase that does nothing at all — and the numbers alone do not
// say so, because they move on every hull.
//
// `attrAbility` was a private copy of this test here and another in gear.js; the
// stats page needed a third, which is when it moved to ability.js beside the
// dials it names.
const tunes = e => [...new Set((e.mods ?? []).map(([a]) => attrAbility(a)).filter(Boolean))][0] ?? null;
const flyerOf = ability => Object.values(HULLS).find(h => h.ability === ability);

// Where this item would actually go. Most things join a rack; a collector rig
// only ever rides a drone, so previewing it in a rack would price a fit that
// cannot exist.
const onADrone = item => EQUIPMENT[item]?.slot === 'drone';
const withItem = (fit, item) => {
  const next = { weapon: [...fit.weapon], generator: [...fit.generator], tech: [...fit.tech] };
  const slot = EQUIPMENT[item]?.slot;
  if (next[slot]) next[slot] = [...next[slot], item];
  return next;
};

// The second line of a technology row, and the only one that is not a number.
// What an entry LETS YOU DO is the thing being sold; `spends` names the cost when
// that cost is not an attribute, and a per-entry line spells out the one number
// that makes it concrete. Read off tech.js's own constants, so the shop cannot
// end up quoting a rate somebody has since moved.
const DETAIL = {
  plating:     () => `The plating takes it, you keep ${Math.round(PLATE_BACK * 100)}% of your hull, and it is spent until you dock.`,
  foundry:     () => `A full hold mends a full hull. Needs ${FOUNDRY_QUIET}s clear of fire.`,
  waketap:     () => 'A kill hands back the seconds of reactor the fight took.',
  compensator: () => `Holds off ${SHEAR_GRACE}px of shear at a full tank, less as it empties.`,
  filter:      () => `Aspect stops hiding anything — and every hostile opens on you ${Math.round((LOUD - 1) * 100)}% further out.`,
};

// Said the same way everywhere, because "where can I buy this" is one question
// and two answers to it is how a pilot ends up flying to the wrong ring.
const SOLD_FRONTIER = 'Sold only at an outpost bay you rent.';
const SOLD_STATION  = 'Sold at your base ring or at an outpost bay.';
const SOLD_ANYWHERE = 'Sold anywhere, docked or not.';

// ctx is the ship as it stands:
// { hull, fit, drones, formation, gear, hulls, formations, credits, ammo, kits, devices }
export function tipFor(kind, key, ctx) {
  const { hull, fit, drones = [], formation } = ctx;
  // Every resolve() below carries the pilot's earned berths, and the two on the hull
  // row deliberately do not: those two compare two BARE CHASSIS, which is a question
  // about what the shop sells rather than about this pilot. Without it a Bulwark
  // flying twelve drones read its own "now" as ten and every tip on the page quoted
  // a delta against a ship the pilot was not in — the workshop-dock bug again, in the
  // one panel whose whole job is telling you what a purchase would do.
  const spare = bonusBays(ctx.unlocked);
  const now = resolve(hull, fit, drones, formation, spare);

  if (kind === 'item') {
    const e = EQUIPMENT[key];
    if (!e) return null;
    const room = (slotsOf(hull)?.[e.slot] ?? 0) - (fit[e.slot]?.length ?? 0);
    const dupe = e.slot === 'tech' && (fit.tech ?? []).concat(drones).includes(key);
    const capped = e.kind === 'rocket' && launcherRoom(hull, fit) <= 0;
    const bays = drones.filter(d => d === null).length;
    return {
      title: e.name, price: e.price, blurb: e.blurb,
      // The sentence the shelf is now built around. Drawn on its own line and in
      // its own colour, above the numbers, because on this shop what a thing
      // LETS YOU DO is the purchase and the numbers are the receipt.
      does: e.does ?? null,
      sub: onADrone(key) ? 'goes in the rig bay, on a drone' : `goes in a ${e.slot} slot`,
      lines: capped ? []
           : onADrone(key) ? diffLines(now, resolve(hull, fit, [...drones, key], formation, spare))
           : diffLines(now, resolve(hull, withItem(fit, key), drones, formation, spare)),
      notes: [
        ...(() => {
          const need = tunes(e);
          if (!need) return e.kind === 'collector' ? [`Hauls anything within ${e.reach} of the drone.`] : [];
          const ab = ABILITIES[need], flyer = flyerOf(need);
          return [HULLS[hull]?.ability === need ? `Retunes your ${ab.name}.`
                                                : `Nothing on this hull — only the ${flyer.name} has a ${ab.name}.`];
        })(),
        DETAIL[key] ? DETAIL[key]() : null,
        e.spends ? `Costs you ${SPENDS[e.spends]}.` : null,
        dupe ? 'Already fitted. One of each technology per ship.'
        : capped ? `Full: ${launcherCap(hull)} launchers on a ${HULLS[hull]?.name ?? 'hull'}. Strip one first.`
        : e.kind === 'rocket' ? `${launcherRoom(hull, fit)} of ${launcherCap(hull)} launcher slots left. Not on a drone.`
        : onADrone(key) ? (bays ? `Rides a drone. You have ${bays} empty bay${bays === 1 ? '' : 's'}.`
                          : drones.length ? 'Rides a drone, and every bay of yours is full.'
                                          : 'Rides a drone, and you do not own one yet.')
        : room > 0 ? `${room} ${e.slot} slot${room === 1 ? '' : 's'} free on this hull.`
        : 'No slot free. Strip one, or hang this on a drone.',
        frontierOnly(key) ? SOLD_FRONTIER : SOLD_STATION,
      ].filter(Boolean),
      owned: ctx.gear?.[key] ?? 0,
    };
  }

  if (kind === 'hull') {
    const H = HULLS[key];
    if (!H) return null;
    const sl = slotsOf(key);
    const ab = abilityNote(H.ability);
    // Compare bare hull to bare hull: your current rack may not even fit the
    // new ship, so quoting a fitted number would be a lie.
    return {
      title: H.name, price: H.price, blurb: H.blurb,
      sub: `${H.cls} · ${sl.weapon} weapon · ${sl.generator} generator · ${sl.tech} tech · ${baysOf(key)} bays`,
      lines: diffLines(resolve(hull, { weapon: [], generator: [], tech: [] }, [], formation),
                       resolve(key,  { weapon: [], generator: [], tech: [] }, [], formation)),
      notes: [
        ab ?? 'No system of its own — the other three have one.',
        ctx.hulls?.includes(key) ? 'In your hangar. Click to fly it.'
                                 : 'Bare hull against bare hull; your modules move over.',
      ],
      owned: ctx.hulls?.includes(key) ? 1 : 0,
    };
  }

  if (kind === 'form') {
    const F = FORMATIONS[key];
    if (!F) return null;
    const n = drones.length;
    // How many drones this ship needs for the full bonus is itself a fitted
    // attribute now, so read it off the resolved ship rather than off BONUS_AT —
    // which is only its default. The `??` is what keeps this honest if the row
    // ever goes away again.
    const at = Math.max(1, now.cohesion ?? BONUS_AT);
    // escortScale, not a second copy of it: the number quoted here has to be the
    // number resolve() folded in, or the tooltip is describing a different ship
    // from the one the panel beside it is drawing.
    const scale = escortScale(n, now);
    return {
      title: F.name, price: F.price, blurb: F.blurb,
      sub: n === 0 ? `no effect until you own a drone (full at ${at})`
         : `${Math.round(100 * scale)}% of its effect with ${n} drone${n === 1 ? '' : 's'}`,
      lines: diffLines(now, resolve(hull, fit, drones, key, spare)),
      notes: [
        `Your escort flies it. Full strength at ${at} drones.`,
        ctx.formations?.includes(key) ? 'Owned. Click to fly it.' : SOLD_STATION,
      ],
      owned: ctx.formations?.includes(key) ? 1 : 0,
    };
  }

  if (kind === 'drone') {
    // Bays, not escort entries. ctx.drones is escortOf(bays, rig), so counting it
    // whole made an eleven-bay pilot with a collector read as twelve and the
    // tooltip vanish off a row the store was still drawing.
    const n = drones.filter(k => !isCollector(k)).length;
    if (n >= baysOf(hull, spare)) return null;
    // A drone's worth depends entirely on what you hang on it, so show the best
    // case you could actually build today rather than an empty bay's zero.
    const best = topTier('weapon');
    return {
      title: `Drone ${n + 1}`, price: dronePrice(n),
      blurb: 'An escort ship. It carries one module of yours.',
      sub: `bay ${n + 1} of ${baysOf(hull, spare)} on a ${HULLS[hull]?.name ?? 'hull'} · each bay costs more than the last`,
      lines: diffLines(now, resolve(hull, fit, [...drones, best], formation, spare)),
      notes: [
        `Shown carrying one ${EQUIPMENT[best].name}.`,
        'It takes anything but a launcher or a collector rig.',
      ],
      owned: 0,
    };
  }

  if (kind === 'ammo') {
    const a = AMMO[key];
    if (!a) return null;
    const rocket = a.for === 'rocket';
    const gun = rocket ? 'launcher' : 'emitter';
    const attr = rocket ? 'rocketVolley' : 'damage';
    // whyNotBuy words this for the shop row, where there is room to name the page
    // you should go to. A tip is fifty columns wide, so it states the same two
    // facts and stops — the rung it wants, and the rung you are on.
    const need = NEEDS[key] ?? 1;
    const have = bestTierFor(a.for, fit, drones, EQUIPMENT);
    return {
      title: a.name, price: a.price, blurb: a.blurb,
      sub: `crate of ${a.pack} rounds · ${round(a.price / a.pack)} cr each`,
      lines: [line(attr, ATTRS[attr].label, now[attr], now[attr] * a.mult, ATTRS[attr].unit ?? '')],
      notes: [
        need > 1 && have < need ? `Needs a tier ${need} ${gun}. You fly ${have ? 'tier ' + have : 'none'}.`
                    : `Feeds every ${gun} you fly, escort included.`,
        SOLD_ANYWHERE,
      ],
      owned: ctx.ammo?.[key] ?? 0,
    };
  }

  if (kind === 'kit') {
    const k = KITS[key];
    if (!k) return null;
    return {
      title: k.name, price: k.price, blurb: k.blurb,
      sub: `one use · ${k.secs}s standing still`,
      lines: [line('hull', 'Hull mended', 0, now.hull * k.heal)],
      notes: [
        `Needs ${KIT_QUIET}s since the last hit, and a hit cancels it.`,
        SOLD_STATION,
      ],
      owned: ctx.kits?.[key] ?? 0,
    };
  }

  if (kind === 'device') {
    const d = DEVICES[key];
    if (!d) return null;
    return {
      title: d.name, price: d.price, blurb: d.blurb,
      sub: `one use · ${d.secs}s to fold`,
      lines: [line('secs', 'Fold time', 0, d.secs, 's', false)],
      notes: [
        'Only spent on arrival. A hit cancels it, for free.',
        SOLD_STATION,
      ],
      owned: ctx.devices?.[key] ?? 0,
    };
  }
  return null;
}
