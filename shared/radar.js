// Who a given player can see.
//
// This runs on the server and nowhere else. If the client did the filtering, every
// enemy's position would still be on the wire and a patched client would simply
// draw them — the same reason movement is intent-only.

import { MAPS } from './maps.js';

export const ALLY = 2, FRESH = 1, STALE = 0;

// Friendly is blue, hostile is red, and neither is up for negotiation by company.
// The plot used to paint allies in their company's colour, which told you nothing
// — ALLY is only ever set for your own company, so it was your own colour every
// time — and it meant KVR pilots read their own wingmen in the same purple the
// game uses for a threat everywhere else.
export const ALLY_DOT = '#4fc3f7';

// Allies are always visible: they transmit their position to you, no scanning
// involved. Enemies have to be found — and once found, they stay on your plot for
// their own signature duration after leaving your radius, so a Bulwark is far
// harder to shake than a Kestrel.
export function stepContacts(viewer, others, dt) {
  for (const [id, left] of viewer.contacts) {
    const next = left - dt;
    if (next <= 0) viewer.contacts.delete(id);
    else viewer.contacts.set(id, next);
  }

  const seen = new Map();
  const range = viewer.ship.stats.radar;
  for (const o of others) {
    if (o.co === viewer.co) { seen.set(o.id, ALLY); continue; }
    const d = Math.hypot(o.ship.x - viewer.ship.x, o.ship.y - viewer.ship.y);
    if (d <= range) {
      viewer.contacts.set(o.id, o.ship.stats.signature);   // refresh while held
      seen.set(o.id, FRESH);
    } else if (viewer.contacts.has(o.id)) {
      seen.set(o.id, STALE);                               // still plotted, fading
    }
  }
  return seen;
}
