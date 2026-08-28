// What a thing in the station actually does to YOUR ship.
//
// A blurb like "hard to track, and half blind" reads well and tells you nothing.
// These build the real numbers: every attribute the item moves, the value you
// have now, and the value you would have after. Computed by resolving the ship
// twice rather than by reading the mod list, so a change to how mods stack shows
// up here for free and can never quietly disagree with the ship you fly.

import { ATTRS, HULLS, resolve, slotsOf } from './ships.js';
import { EQUIPMENT, SLOTS, MAX_DRONES, dronePrice, topTier } from './gear.js';
import { FORMATIONS, BONUS_AT, bonusScale } from './formation.js';
import { launcherRoom, MAX_LAUNCHERS } from './rockets.js';

const round = v => Math.abs(v) >= 100 ? Math.round(v)
                 : Math.abs(v) >= 10  ? Math.round(v * 10) / 10
                                      : Math.round(v * 100) / 100;

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

const withItem = (fit, item) => {
  const next = { weapon: [...fit.weapon], generator: [...fit.generator], tech: [...fit.tech] };
  next[EQUIPMENT[item].slot] = [...next[EQUIPMENT[item].slot], item];
  return next;
};

// ctx is the ship as it stands: { hull, fit, drones, formation, gear, hulls, formations, credits }
export function tipFor(kind, key, ctx) {
  const { hull, fit, drones = [], formation } = ctx;
  const now = resolve(hull, fit, drones, formation);

  if (kind === 'item') {
    const e = EQUIPMENT[key];
    if (!e) return null;
    const room = (slotsOf(hull)?.[e.slot] ?? 0) - (fit[e.slot]?.length ?? 0);
    const dupe = e.slot === 'tech' && (fit.tech ?? []).concat(drones).includes(key);
    const capped = e.kind === 'rocket' && launcherRoom(fit) <= 0;
    return {
      title: e.name, price: e.price, blurb: e.blurb,
      sub: `${e.slot} slot`,
      lines: capped ? [] : diffLines(now, resolve(hull, withItem(fit, key), drones, formation)),
      note: dupe ? 'already fitted — one of each technology'
          : capped ? `${MAX_LAUNCHERS} launchers is the limit — strip one first`
          : e.kind === 'rocket' ? `${launcherRoom(fit)} of ${MAX_LAUNCHERS} launcher slots left · never rides a drone`
          : room > 0 ? `${room} ${e.slot} slot${room === 1 ? '' : 's'} free`
          : 'rack is full — put it on a drone, or strip a slot first',
      owned: ctx.gear?.[key] ?? 0,
    };
  }

  if (kind === 'hull') {
    const H = HULLS[key];
    if (!H) return null;
    const sl = slotsOf(key);
    // Compare bare hull to bare hull: your current rack may not even fit the
    // new ship, so quoting a fitted number would be a lie.
    return {
      title: H.name, price: H.price, blurb: H.cls,
      sub: `W${sl.weapon}  G${sl.generator}  T${sl.tech}`,
      lines: diffLines(resolve(hull, { weapon: [], generator: [], tech: [] }, [], formation),
                       resolve(key,  { weapon: [], generator: [], tech: [] }, [], formation)),
      note: ctx.hulls?.includes(key) ? 'in your hangar — click to fly it'
                                     : 'bare hull against bare hull; your modules move across',
      owned: ctx.hulls?.includes(key) ? 1 : 0,
    };
  }

  if (kind === 'form') {
    const F = FORMATIONS[key];
    if (!F) return null;
    const n = drones.length;
    return {
      title: F.name, price: F.price, blurb: F.blurb,
      sub: n >= BONUS_AT ? 'at full effect'
         : n === 0 ? `no effect until you own a drone (full at ${BONUS_AT})`
         : `${Math.round(100 * bonusScale(n))}% of its effect with ${n} drone${n === 1 ? '' : 's'}`,
      lines: diffLines(now, resolve(hull, fit, drones, key)),
      note: ctx.formations?.includes(key) ? 'owned — click to fly it' : '',
      owned: ctx.formations?.includes(key) ? 1 : 0,
    };
  }

  if (kind === 'drone') {
    const n = drones.length;
    if (n >= MAX_DRONES) return null;
    // A drone's worth depends entirely on what you hang on it, so show the best
    // case you could actually build today rather than an empty bay's zero.
    const best = topTier('weapon');
    return {
      title: `Drone ${n + 1}`, price: dronePrice(n), blurb: 'Flies escort. One slot, anything you like in it.',
      sub: `${n}/${MAX_DRONES} bays used`,
      lines: diffLines(now, resolve(hull, fit, [...drones, best], formation)),
      note: `shown carrying a ${EQUIPMENT[best].name}; a drone with an emitter is a real gun`,
      owned: 0,
    };
  }
  return null;
}
