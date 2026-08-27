// Account persistence. A JSON file, written by rename so a crash mid-write cannot
// leave a half file behind. Deliberately not a database yet — this is small
// enough to read with an editor, and swapping it for Postgres later means
// replacing two functions.

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data', FILE = path.join(DIR, 'accounts.json');

export function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { accounts: raw.accounts ?? {}, seq: raw.seq ?? Object.keys(raw.accounts ?? {}).length };
  } catch {
    return { accounts: {}, seq: 0 };               // first run, or an unreadable file
  }
}

export function save(state) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);                      // atomic on the same filesystem
    return true;
  } catch (e) {
    console.error('could not save accounts:', e.message);
    return false;
  }
}
