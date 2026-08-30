// Flying on the keyboard.
//
// WASD is a direction, not a destination: it feeds exactly the same 'dir' intent
// that holding the mouse down does, so the server learns nothing new and there is
// no second way to move a ship that could disagree with the first.
//
// Screen axes, y growing downward, matching every other vector the client sends.
//
// Both bindings are listed rather than one aliased to the other, because they are
// not the same choice: WASD keeps a hand near 1/2/3, TAB and SPACE, and the arrows
// free that hand entirely by moving flying to the other one. Nobody has to pick
// in advance — holding W and ArrowUp at once is just up, since the sum is
// normalised like any other pair.
//
// e.key for an arrow is 'ArrowUp', and the handler lower-cases before it looks
// here, so these are the lower-cased names.
export const STEER_KEYS = {
  w: [ 0, -1],  arrowup:    [ 0, -1],
  a: [-1,  0],  arrowleft:  [-1,  0],
  s: [ 0,  1],  arrowdown:  [ 0,  1],
  d: [ 1,  0],  arrowright: [ 1,  0],
};

export const isSteerKey = k => Object.hasOwn(STEER_KEYS, k);

// Sum the keys that are down and normalise. The server already scales any
// throttle above 1 back down, so it is not the diagonal speed that needs this —
// it is that the caller has to be able to tell "no direction" from "a direction",
// and W+S summing to nothing must read as a stop rather than as a vector the
// server will quietly treat as one. Returns null when the keys cancel out or
// none are down, so releasing and countermanding take the same path.
export function steerVector(down) {
  let x = 0, y = 0;
  for (const k of down) {
    const v = STEER_KEYS[k];
    if (v) { x += v[0]; y += v[1]; }
  }
  const d = Math.hypot(x, y);
  return d < 1e-9 ? null : { dx: x / d, dy: y / d };
}
