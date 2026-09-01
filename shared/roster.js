// Several pilots in one browser, one of them flying.
//
// The token in local storage has always BEEN the identity: the client sends it,
// the server looks up `db.accounts[token]`, and that is the whole of who you
// are. Nothing about that changes here. What changes is that the browser now
// remembers the OTHER tokens it has seen, so a pilot can be put down and picked
// up again from the menu instead of being lost the moment a second one exists.
//
// Deliberately NOT a server concept. The server has no idea two accounts belong
// to one person and must not: a roster it believed would be a roster a client
// could lie about, and there is nothing it would buy. Two pilots in one browser
// are two strangers as far as the world is concerned — different names,
// possibly different companies, no shared credits, no shared anything. That is
// the point of the feature, not a compromise in it.
//
// It lives in `shared/` for the reason shared/music.js does: the rules want
// testing without a browser, and a stub that only tests itself is worse than no
// test.

// The cap comes from the panel, because it IS a fact about the panel: it is how
// many berths the menu can show at the shortest window the game ships for. One
// import rather than a re-export, so there is a single place to read it from.
import { MAX_PILOTS } from './settings.js';
import { TOKEN_KEY, OLD_TOKEN_KEYS, ROSTER_KEY } from './brand.js';

// One line of the menu. Everything here is a copy of what the server said on the
// last welcome — the account is still the truth, and this is only enough to tell
// two parked pilots apart. A row of bare tokens would be a list nobody can read.
export const entry = (token, { name = '', co = '', hull = '', level = 1 } = {}, at = Date.now()) =>
  ({ token: String(token), name: String(name), co: String(co), hull: String(hull),
     level: Math.max(1, Math.floor(+level || 1)), at: Math.floor(+at || 0) });

// Whatever came out of local storage is untrusted in exactly the way a save file
// is: it was a JSON string a moment ago and the person holding it can edit it.
// Anything without a token is not a pilot; anything past the cap is a row the
// menu could not show anyway.
export function sanitiseRoster(raw, cap = MAX_PILOTS) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const tok = typeof r?.token === 'string' ? r.token : '';
    if (!tok || seen.has(tok)) continue;           // a duplicated token is one pilot, twice
    seen.add(tok);
    out.push(entry(tok, r, r?.at));
    if (out.length >= cap) break;
  }
  return out;
}

// Most recently flown first, so the menu is in the order somebody would guess
// and so `forget` has an obvious pilot to fall back to.
const bySeen = (a, b) => b.at - a.at;

// Upsert. The same token twice is the same pilot with a newer name, hull or
// rank — a pilot who renamed nothing and bought a Bulwark should not appear in
// the menu twice flying two different ships.
export function remember(list, e, cap = MAX_PILOTS) {
  const rest = sanitiseRoster(list, cap).filter(p => p.token !== e.token);
  return [e, ...rest].sort(bySeen).slice(0, cap);
}

export const forget = (list, token, cap = MAX_PILOTS) =>
  sanitiseRoster(list, cap).filter(p => p.token !== token);

// The pilots you are not. What the menu draws as berths.
export const parked = (list, active) =>
  sanitiseRoster(list).filter(p => p.token !== active).sort(bySeen);

// --- local storage ------------------------------------------------------------
// Every one of these swallows. `localStorage` throws in a private window, with
// site data blocked, and inside the thumbnailer — and a browser that will not
// remember you is a browser with one pilot, which is what every browser was
// before this file. It is never a reason for the game not to start.

export function readRoster(store) {
  try { return sanitiseRoster(JSON.parse(store.getItem(ROSTER_KEY) ?? '[]')); }
  catch { return []; }
}

export function writeRoster(store, list) {
  try { store.setItem(ROSTER_KEY, JSON.stringify(sanitiseRoster(list))); return true; }
  catch { return false; }
}

// Read the pilot being flown, carrying one across the rename that orphaned them
// under the old key.
export function readActive(store) {
  try {
    const cur = store.getItem(TOKEN_KEY);
    if (cur) return cur;
    for (const k of OLD_TOKEN_KEYS) {
      const old = store.getItem(k);
      if (old) { store.setItem(TOKEN_KEY, old); store.removeItem(k); return old; }
    }
  } catch {}
  return '';
}

// Become somebody else, or nobody. An empty token is a stranger: the connect URL
// carries nothing, the server finds no account and answers with the join form.
//
// The old keys go with it. readActive() migrates them on the way in and deletes
// them as it does, so by here they are already gone — but a browser that has not
// loaded the game since the rename would otherwise have `aphelion.token` sitting
// there ready to resurrect the pilot you just put down as soon as the page
// reloads, which is the switch silently not happening.
export function setActive(store, token) {
  try {
    if (token) store.setItem(TOKEN_KEY, token);
    else store.removeItem(TOKEN_KEY);
    for (const k of OLD_TOKEN_KEYS) store.removeItem(k);
    return true;
  } catch { return false; }
}
