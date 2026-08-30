// How long someone has actually been flying, as opposed to how long a tab was
// left open.
//
// The client signs itself out after half an hour of no input, so a session that
// ends that way has a long tail with nobody present for it. Counting up to the
// pilot's last real action rather than to the disconnect removes exactly that
// tail, and it needs no special case for how the session ended: someone who
// closes the tab mid-fight loses nothing, because their last action was a moment
// ago, and someone who wandered off loses precisely the time they were away.
export const sessionSeconds = (from, to) =>
  Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.round((to - from) / 1000)) : 0;

// Banked in pieces rather than all at the end, so a crash or a deploy costs at
// most the seconds since the last save instead of the whole session.
export function bankPlaytime(account, p, now = Date.now()) {
  const to = p.acted ?? now;
  account.played = Math.max(0, Math.floor(account.played ?? 0)) + sessionSeconds(p.banked ?? to, to);
  p.banked = to;
  return account.played;
}

// "3h 24m", "24m", "51s". Hours stop being interesting to the minute, and a
// number of seconds stops being interesting at all after the first minute.
export function fmtPlayed(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
