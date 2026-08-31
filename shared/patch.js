// The changelog the game shows about itself.
//
// Newest first, and deliberately terse: this is a list a player reads in fifteen
// seconds to see that the game is moving, not a commit log. The reasoning behind
// any of it lives in the commit that made the change.
//
// The version is <major>.<minor> and the minor climbs once per shipped batch.
// Add the new entry at the TOP and bump VERSION with it — the client shows
// VERSION beside the icon, so the two drifting apart is immediately visible.

export const VERSION = '0.72';

export const PATCHES = [
  { v: '0.72', notes: [
    'The deep sectors have a pirate outpost now — one shop, same place in all three',
    'It sells ore, and a bay rented there costs ten million and rank 39',
    'Rent one and you refit, buy and respawn four hops out instead of flying home',
    'The ring keeps the peace, but not from anything you have already shot at',
  ] },
  { v: '0.71', notes: [
    'Duels: /1v1 <callsign> challenges another pilot, /accept or /decline answers it',
    'Both of you fold out to a sector a quarter the usual size, with a wall for an edge',
    'Five seconds where nothing moves or fires, then it is a fight — and it is real PvP',
    'The loser drops what dying costs: a tenth of their credits, and their whole hold',
    'Both are pods the winner scoops. Leaving early is conceding, and it pays the same',
    'A portal in the middle takes you home. Nobody falls in five minutes and it is a draw',
    'Claims fold out now too — five seconds, and one hit cancels it. No more free escapes',
  ] },
  { v: '0.70', notes: [
    'Drumfire got serious: a full drum is two and a half times your cycle, not half again',
    'That is twice what an interceptor throws with its whole reactor on its guns',
    'Your reach still drops to 65% — 455px, the shortest in the game, so you go in close',
    'The Drum Governor turned around: it buys your reach back at four fifths of the drum',  ] },
  { v: '0.69', notes: [
    'A claim is a hunt now: everything in it sees you from the far side of the map',
    'They all come at once, at their own speeds, so the field arrives as a stream',
    'Correction to 0.64 — your shields DO come back in a claim. That was a mistake',
    'The fields are smaller and every one of them is already on its way to you',
    'A Kedge holds the deepest rock, hauling you back into the rings you just left',
    'The shield bar counts down to the second your shields start coming back up',
    'It counts the delay your ship actually flies, so power in shields shortens the wait',
  ] },
  { v: '0.68', notes: [
    'A fully researched ship no longer prints its shield through the number beside it',
    'The station’s stat line sizes its columns to the biggest number you can reach',
    'Money, rank and the rank bar sit a clear character apart at eight figures',
    'The docked prompt drops to the HUD’s own spacing instead of crowding the line above',
    'The game now knows what window you play in, and checks its own layout at that size',    'The shield bar counts down to the second your shields start coming back up',
    'It counts the delay your ship actually flies, so power in shields shortens the wait',
    'At your own dock it counts to the dock’s clock instead, which comes round sooner',  ] },
  { v: '0.67', notes: [
    'The Vanguard’s system is rate of fire now — every gun and every rack cycles faster',
    'Half again the shots at full, and your reach drops to 65% to pay for it',
    'Lock is gone: an Aspect Filter already found a Bandit, and any hull can buy one',
    'Drum Governor replaces the Lock Repeater — half your reach, and double the rate',
    'Siege and Rapid Cadence no longer cancel into a free half-again of damage',
    'Percentages compound now, so a trade and its opposite come out at exactly x1.00',
    'A Kedge hits for 467 a bolt: its gun is a share of the ship it is posted against',
  ] },
  { v: '0.66', notes: [
    'The Corsair Hive has moved to the gates. Something worse holds the deeps now',
    'A Vitriol lays pools of Aqua Regia where you were standing, and they stay there',
    'A Doldrum lays stills: cross one and your engines cut for a second and a half',
    'You keep your speed and your guns — you just cannot change course. Watch your line',
  ] },
  { v: '0.65', notes: [
    'The hotkey strip no longer runs across the minimap and the star chart button',
    'It wraps onto a second line instead, and keeps clear of the reactor dial too',
    'Tooltips wrap what they have to say rather than writing it past their own frame',
    'The sector name, the cargo count and the beacon label all have room to breathe',
  ] },
  { v: '0.64', notes: [
    'Claims got hard. Nothing in one ever breaks off — you cannot walk away and wait',
    'And your shields do not come back in there, so the ship you arrive in is all you get',
    'Clearing one now costs about nine tenths of your ship instead of a third',
    'Flying into the middle of a claim kills you, at every tier, not just the first',
    'Kedges hold the upper two rocks: they haul you back onto ground you just gave up',
  ] },
  { v: '0.63', notes: [
    'A Thresher fills its chamber faster: the bolt it throws back now reads 9,706',
    'Route power to your weapons and it loads harder — that is where the size is',
    'Routing power costs you nothing over a fight — the same damage, fewer pieces',
    'Weaving still beats one from x8 hull and shields; standing still needs x16',
  ] },
  { v: '0.62', notes: [
    'Eight places printed two labels on top of each other. None of them do now',
    'The station’s hint line no longer runs through the INVENTORY and STATS tabs',
    'LVL stays readable while docked, and the cargo count clears the SELL button',
    'The star chart legend fits, and the hotkey strip goes around the ammunition bar',
    'The threat file counts entries again — it had started quoting its scroll offset',
  ] },
  { v: '0.61', notes: [
    'A loaded Thresher now throws back the sharpest gun in the shop — 12,083 a bolt',
    'It was capped at 855. Stand still in a finished ship and you are gone in 3.7s',
    'It still cannot throw more than money can buy, and it still empties if you stop',
    'Bring a smaller gun: a Kestrel that weaves kills one without breaking a sweat',
  ] },
  { v: '0.60', notes: [
    'A mining rig is a rock somebody is holding. Fight for it before you can buy it',
    'The claim drops you alone in a sector with the rock and a field around it',
    'Dying there costs nothing — no toll, no cargo — and you keep nothing either',
    'A freed rock can be flown again from the CLAIMS tab: practice, paying nothing',
  ] },
  { v: '0.59', notes: [
    'Hulls are different ships now, not the same ship at four prices',
    'A Vanguard has five hardpoints and may fill all five with rocket racks',
    'A Bulwark has three generators, and its shields come back in 30s instead of 56',
    'Every ship still has nineteen mounts — the bigger it is, the more are welded in',
    'So a Vanguard berths eleven drones and a Bulwark ten; bays you own are never lost',
    'Fixed: buying a hull left a rack on it the hull cannot hold, until your next save',
    'Fixed: a hull with fewer slots than your last one quietly deleted the difference',
  ] },
  { v: '0.58', notes: [
    '/reset now actually resets — it was leaving your research station standing',
    'A reset pilot kept a 500,000cr lab and a x4 hull with no credits to pay for it',
    'And the station itself stayed standing in the ring, owned by nobody',
  ] },
  { v: '0.57', notes: [
    'The STATS page shows every number on your ship, not the eleven it used to',
    'Weapon range, capacitor, rockets, the reactor and your hull’s own system are all on it',
    'Grouped under headings, each row saying in a line what the number means',
    'Shield regen reads 1.79%/s and "56s to refill" instead of 0.0%',
    'The shop footer counts rows again — it had started quoting how far it scrolled',
  ] },
  { v: '0.56', notes: [
    'Everything that scrolls now scrolls the way the threat file does',
    'The shop, the locker, the stats page and this changelog move by pixels, eased',
    'They used to jump a whole row a notch, and the stats page barely moved at all',
  ] },
  { v: '0.55', notes: [
    'Fixed: your hull and shield readouts showed what the shops sold you, not what you fly',
    'Research WAS working — the two numbers you watch while swapping ships never showed it',
    'The HUD also ignored your escort and formation: GUN 113 on a ship doing 2,815',
    'And the STATS page scrolls properly now, so you can reach the rows below the fold',
  ] },
  { v: '0.54', notes: [
    'A Thresher now carries its payload over its head — watch it fill as you shoot it',
    'Stop shooting for a second and the chamber halves, and so does the next bolt',
    'It can no longer one-shot you: a full chamber is 855 a second, a Hive throws 2,450',
    'A bigger gun makes the fight shorter now, not deadlier',
  ] },
  { v: '0.53', notes: [
    'Kedges hold the gates beside the Threshers — something out there you can actually kill',
    'It takes a fix on where you are standing and three seconds later puts you back on it',
    'It has to stand dead still to do it. That is when you kill it',
    'A portal mouth breaks the fix. Leaving takes twice as long and it always works',
  ] },
  { v: '0.52', notes: [
    'Research rungs say what they do for you even when you cannot afford them yet',
    'And how far off you are — "640k cr to go" instead of a flat refusal',
    'Hover a rung to see what the rest of that ladder costs and ends at',
  ] },
  { v: '0.51', notes: [
    'A STATS tab at the station: where every number on your ship came from',
    'The ship, then your guns and generators, then technologies, then research',
    'Each layer shows what it started with, what it ended with, and the multiple',
  ] },
  { v: '0.50', notes: [
    'Beacons work from inside a hangar now — fold straight from your ring to your bay',
    'It only refuses if you are already standing where it would put you',
    'Two of everything, everywhere — nothing in the game is posted alone any more',
    'Kill a Hive and there is still a Hive on that map, with another on the way',
    'Bosses refill like everything else now: 200s with one still up, 150s if you clear both',
    'The gates and the deeps used to go completely empty the moment you killed their one thing',
  ] },
  { v: '0.49', notes: [
    'Rank no longer stops at 60 — it keeps climbing, and keeps counting what you do',
    'The old ceiling was about nine Corsair Hives, so people were hitting it',
  ] },
  { v: '0.48', notes: [
    'The threat file scrolls smoothly, by pixels, with a bar showing where you are',
    'It used to jump a whole entry per notch, and stick once you passed the end',
  ] },
  { v: '0.47', notes: [
    'Shields come back as a share of the pool now, not a fixed number per second',
    'A fully researched Bulwark took 90 minutes to refill. It takes 56 seconds',
    'Every hull refills in the seconds it always did, however large its shield gets',
  ] },
  { v: '0.46', notes: [
    'Press L for your THREAT FILE: everything you have killed, and how many',
    'Each entry carries its outline, its numbers, and one line on what it actually does',
    'A hostile you have never killed is not in there at all. You have to earn the page',
    'Four more ambient tracks and four more combat tracks are live',
  ] },
  { v: '0.45', notes: [
    'Fixed: the second research rung quoted the numbers of the first one',
    'It said "shield 3,700 -> 7,400" when you already had 7,400 and were buying 14,800',
    'Your ship readout was a tier behind too — it showed what the shops sold you',
  ] },
  { v: '0.44', notes: [
    'Fixed: the beacon refused to fold you to a bay it was listing right in front of you',
    'And a second hangar in that menu could not be clicked at all',
  ] },
  { v: '0.43', notes: [
    'The SPACE prompt gets out of the way while you are choosing ammunition',
    'Same for the repair rack and the beacon\'s list of hangars — all of them covered it',
  ] },
  { v: '0.42', notes: [
    'The SPACE prompt sits clear of the weapon tooltips instead of under them',
    'Combat music holds for 14 seconds, not 7 — long enough to reach the next kill',
    'It was dropping out about a second before the next fight started, every time',
  ] },
  { v: '0.41', notes: [
    'Fly to your research station and it tells you to press R',
    'Every rung now says what it does to the ship you are flying: hull 1,100 -> 2,200',
    'The mine quotes the rate and what it comes to over a day',
  ] },
  { v: '0.40', notes: [
    'Fixed: dying at a rented bay put you in the corner of the map, unable to move',
    'Dying again did not help. Respawning has been landing nowhere since 0.33',
    'Anyone stuck is put back at their own dock the moment they reconnect',
  ] },
  { v: '0.39', notes: [
    'A Censer holds the other hop out: a reactor with no containment and no gun',
    'Its ring is the fight — it widens as you kill it, and you are standing in it',
    'It burns a share of you per second, so no amount of research makes it safer',
    'When it dies the ring stands for 1.8 seconds, then lets go of everything left',
    'Be somewhere else. Hold 85% of your reach and it costs you almost nothing',
  ] },
  { v: '0.38', notes: [
    'A Lamprey holds the frontier. It has no gun — it opens a tether onto your hull',
    'It drinks straight past your shields and mends itself with what it takes',
    'It takes a SHARE of your hull, so no amount of research makes it safer',
    'Break the cord: fly past 900 and it snaps. Route to thrusters or you cannot',
    'Sanctuary is total against it. A base ring or a portal mouth and it has nothing',
    'One friend standing still is worth nothing. Two taking turns kill it',
  ] },
  { v: '0.37', notes: [
    'Every sector further from home now holds something harder than the one before it',
    'The two sectors out of home were 6,500 and 65,000. They are the same fight now',
    'Leviathans moved out to the frontier, where the Bandits already were',
    'The deeps were easier than the gates you cross to reach them. Now the Hive is there',
    'Threshers hold the gates: a mirror asks what your gun is, not what your hull is',
  ] },
  { v: '0.36', notes: [
    'The deep sectors past the gates were empty. A Thresher holds each one now',
    'It is a mirror: everything you put into it comes back out of it',
    'Standing still costs you 88% of your ship. Sidestepping costs 35%',
    'The first fight whose difficulty is set by your gun rather than by its hull',
    'Staking a research plot asks twice now, and says what it is for and why it sticks',
    'The HUD tells you a research station exists once you are halfway to affording one',
  ] },
  { v: '0.35', notes: [
    'Research stations: stake a plot in your own ring for 500k, with your name on it',
    'Everyone can see everyone\'s. Only yours opens, and it grows as you build on it',
    'Deep Space Mining Operation pays you around the clock, logged in or not',
    'Your credits tick up live while it runs — and keep running while you sleep',
    'Hull and shield ladders: five tiers each, up to 32x what the shops can sell you',
    'Bulk Metallic Glass through Degenerate Matter Plating. A Hive can be soloed',
  ] },
  { v: '0.34', notes: [
    'A cleared sector refills faster, and faster still with more pilots working it',
    'Two Leviathans used to leave the map empty for a minute and a half. Now 45s',
    'A quiet, full sector is unchanged — nothing comes back faster for free',
    'Bosses keep their five minutes: an event should stay an event',
    'The top right says when you are safe, and which kind of safe it is',
    'Portal mouths have always been sanctuary. Now the game admits it',
  ] },
  { v: '0.33', notes: [
    'Pilots have their handle over their bars, so a crowded sector has names in it',
    'A contact your radar has lost stays anonymous — no bars, no name',
  ] },
  { v: '0.32', notes: [
    'The technology shelf is twelve entries, not twenty-six, and every one is a real trade',
    'Every shop row says what the thing lets you DO, and what it costs you to have it',
    'Composite Plating takes the killing blow for you once, and re-seats when you dock',
    'An Ore Foundry mends your hull out of your own ore — a full hold is a full hull',
    'A Wake Tap nearly doubles the tank and fills it by killing rather than by waiting',
    'A Shear Compensator makes the sky past the beacons flyable while your charge holds',
    'An Aspect Filter sees a Bandit from any angle — and everything out there hears you',
  ] },
  { v: '0.31', notes: [
    'A Harrier holds the frontier now: fast, and something to farm while you watch for Bandits',
    'It outruns everything but a Kestrel, so you fight it — you cannot leave',
    'Loot follows the kill: the frontier pays in rhodium and platinum, and never again in iron',
    'A Bandit dropped 216 volume of scrap iron. It drops 96 of rhodium and up',
    'The recall beacon asks where: your ring, or any pirate bay you rent',
    'Better ammunition needs the WHOLE ship specced for it — every gun, escort included',
    'You can still buy it on one good gun. Loading it is the part that asks for the rest',
  ] },
  { v: '0.30', notes: [
    'An INVENTORY tab: everything you own and are not flying, in one place at last',
    'Click anything in it to break it up for 40% — spare guns, generators, whole hulls',
    'Never the ship you are flying, and never your last one',
  ] },
  { v: '0.29', notes: [
    'Collector rigs refine as you fly: the cheapest metal you carry packs into the next one up',
    'Value is kept and space is freed, so the rig refills the room and your hold climbs',
    'A better rig refines faster — the Ore Tender is worth roughly twice the Scavenger',
  ] },
  { v: '0.28', notes: [
    'You come back at the last hangar you used, including a pirate bay you rent',
    'Pirate outposts keep the peace inside the trading zone, so a respawn is not a death loop',
    'The peace stops at the zone edge — step outside and the frontier is unchanged',
  ] },
  { v: '0.27', notes: [
    'Eleven more technologies — your guns, your escort and your hull ability all have one now',
    'Siege and Rapid Cadence trade bolt weight against cadence for exactly the same damage',
    'Launcher Primacy pays your guns into your racks, and is a loss if you fly no racks',
    'Wing Repeaters fly a formation at full strength off one drone; Wing Coupling off six, harder',
    'Your hull ability is fittable now: deepen a Veil, loosen an Anchor, hold a Lock at range',
    'A Null Skin halves the range a Kestrel is found at, and costs a third of its shields',
    'Keel Bracing swells a Bulwark to five and a half times its shield, and parks it there',
  ] },
  { v: '0.26', notes: [
    'Every store row and tooltip says what the thing does and where it is sold',
    'Tooltips cover ammunition, repair drones and beacons too, priced against your ship',
    'A refusal names the fix now: which page to buy on, or how many seconds to wait',
    'Your unfitted gear is your inventory; the ore panel on I is CARGO',
  ] },
  { v: '0.25', notes: [
    'Anything you cannot buy yet now looks locked and says why, instead of just refusing',
  ] },
  { v: '0.24', notes: [
    'Store shelves scroll instead of squeezing every row shorter as they grow',
  ] },
  { v: '0.23', notes: [
    'Eleven new technologies, and the shelf is tiered — Deep Tech is its own page',
    'The Reactor Flywheel did nothing: a bigger tank cannot buy you more uptime',
    'So the reactor shelf is three real trades now — the floor, the rate, or one long hold',
    'Shield technologies buy WHEN, not how much: Snap starts sooner, Deep-Bank pours harder',
    'The Signal Damper mends you sooner too — signature alone was worth nothing to aliens',
    'Your hull decides how many technologies you fly. Drones were a second tech rack',
    'Composite Plating and Hold Expander cost what they are worth now',
  ] },
  { v: '0.22', notes: [
    'MK-III emitters and up, and Tandem launchers and up, are frontier stock now',
    'Your company issues the starter kit — the rest comes off a pirate hulk',
    'Technologies are tiered, and the top rung will be frontier stock too',
    'A berth is 27200 at rank 8: it is the door to the second half of the ladder now',
    'Outposts say what they are for, instead of expecting you to guess',
    'A Fighter running Lock glows, so you can see it between volleys',
  ] },
  { v: '0.21', notes: [
    'Abilities are visible now: a Veil fades you and your drones, a Lock burns orange',
    'And an Anchor braces plates around the hull instead of the usual shield bubble',
    'Ammunition grades need a gun that can fire them — no more buying the best cells on day one',
    'Rent a berth at a pirate outpost and refit there, if the pirates have heard of you',
    'A berth is 102000, rank 20, and shuts the moment anything shoots at you',
    'SPACE at an outpost sells to it instead of hauling in whatever is lying beside it',
  ] },
  { v: '0.20', notes: [
    'Each hull has an ability on 4: Veil on the Kestrel, Lock on the Vanguard, Anchor on the Bulwark',
    'All three scale with the power you route to them, and cost the same capacitor your guns want',
    'Every ship has its own silhouette — an interceptor no longer looks like a smaller bomber',
    'Frame time and ping in the ESC menu, so you can tell your machine from your connection',
    'Credits read as 4.12M instead of 4120000',
  ] },
  { v: '0.19', notes: [
    'The sector arrives as what changed, not all of it again — a twentieth of the traffic',
    'Snapshots are compressed too, so a crowded fight costs a fifteenth of what it did',
  ] },
  { v: '0.18', notes: [
    'Ammunition grades are x1 / x1.25 / x1.5 — a premium on your guns, not a second gun ladder',
    'Crates are one size at every grade, so the better ammunition no longer has the smaller price',
  ] },
  { v: '0.17', notes: [
    'Fixed a reactor exploit: generators past your speed floor were still raising the boost ceiling',
  ] },
  { v: '0.16', notes: [
    'Dying now costs 10% of your credits as well as your cargo — flying empty is no longer free',
  ] },
  { v: '0.15', notes: [
    'Corsair Hives launch a raider every 5s and hold twelve — ignore them and they pile up',
    'The number of pilots online is shown beside the patch notes',
  ] },
  { v: '0.14', notes: [
    'Pirate outposts moved to the frontier sectors, where a full hold actually ends a run',
    'Corsair Hives now hold the three gate sectors instead of Nullpoint, so they get met',
    'A recall folding home draws collapsing rings, and everyone nearby can see it',
  ] },
  { v: '0.13', notes: [
    'Recall Beacons: a single-use device that folds you home over five seconds',
    'One hit breaks the fold — and the beacon is not spent, so you can try again',
  ] },
  { v: '0.12', notes: [
    'Generators raise the reactor ceiling by what they cost you in speed',
    'The Corsair Hive at Nullpoint: ten Leviathans, and it launches the Bandits',
    'Aliens keep out of your docking ring unless they are already chasing you',
    'Pirate outposts are marked on the star chart, not just the sector plot',
  ] },
  { v: '0.11', notes: [
    'Patch notes wrap and scroll instead of cutting every line off halfway',
  ] },
  { v: '0.10', notes: [
    'Pirate outposts in every third sector: sell ore mid-run at 75%, no repairs and no shelter',
    'SPACE at a gate now jumps instead of hauling in whatever is under you',
    'Hostiles respawn clear of anybody already in the sector, not on top of them',
  ] },
  { v: '0.9', notes: [
    'Ore from a shared kill is split like the credits — one pod each, no race',
    'The Leviathan holds the third sector: it cannot be kited, and it cannot be soloed',
    'Aliens switch target if you crowd them for 3s, or out-damage whoever they are on',
    'Every hostile has its own silhouette instead of one arrowhead at four sizes',
    'Ammunition is x1 / x3 / x5 and priced to be worth loading — it was a trap before',
    'Bandits pay 79800: they take 17x as long to kill as an Ironhusk and paid 4.6x',
  ] },
  { v: '0.8', notes: [
    'A collector finishes its pull if you fly off, and comes to you instead of aborting',
    'Drone speed is 1.3x your ship, so it neither teleports nor gets left behind',
    'Fixed the tractor beam flashing for one frame at the start of every pull',
  ] },
  { v: '0.7', notes: [
    'Collector rigs have their own bay and no longer cost you a gun',
    'A pull holds station over the pod for 1.4s, and everyone can see it happen',
    'Every alien drops loot — the Ironhusk and the Bandit had no drop table at all',
  ] },
  { v: '0.6', notes: [
    'Time flown is tracked, in the ESC menu — idle time before an auto sign-out is not counted',
  ] },
  { v: '0.5', notes: [
    'Bounties are shared by damage: a tenth of the work pays, and the pot grows with the party',
    'Arrow keys steer as well as WASD',
    'Friendly ships are blue on the plot instead of your company colour',
  ] },
  { v: '0.4', notes: [
    'WASD flies the ship, so farming does not need the mouse',
  ] },
  { v: '0.3', notes: [
    'Plotted courses land under the cursor — they were short by a fifth on most window sizes',
  ] },
  { v: '0.2', notes: [
    'The game is deployed, and the music streams from the server',
  ] },
  { v: 'earlier', notes: [
    'Everything before the log existed: hulls, drones, formations, rockets, ammunition,',
    'the station, the star chart, radar, the Bandit, repair drones and the soundtrack',
  ] },
];

// --- geometry, so drawing and hit-testing can never disagree ------------------
export const ICON = 26;

// Top right, above where receipts stack. It has to sit clear of them: a button
// that spends half its life underneath a purchase notification is not a button.
export const patchIcon = VIEW_W => ({ x: VIEW_W - ICON - 16, y: 14, w: ICON, h: ICON });

import { rowsIn, barIn, spanOf } from './scroll.js';

export const ROW_H = 15, HEAD_H = 32, PAD = 14, FOOT = 10;

// The notes are set in 10px ui-monospace, so a character is a known width and the
// wrap can be computed here rather than measured in the client. That matters:
// this file decides both what is drawn and what is scrolled through, and a wrap
// that disagreed between the two would scroll past lines nobody ever saw.
export const CHAR_W = 6;

// Anybody who opens a changelog wants to read it. Cutting each line off at the
// panel edge with an ellipsis was the worst of both — it took the space and gave
// back half a sentence.
export function wrapNote(text, cols) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if (line.length + 1 + w.length <= cols) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

// Every line the changelog has, wrapped. One flat list, so scrolling is an index
// into it rather than a second layout pass that could disagree with the first.
export function patchLines(cols) {
  const out = [];
  for (const p of PATCHES) {
    out.push({ kind: 'ver', v: p.v });
    for (const n of p.notes) for (const seg of wrapNote(n, cols)) out.push({ kind: 'note', text: seg });
    out.push({ kind: 'gap' });
  }
  return out;
}

export function patchPanel(VIEW_W, VIEW_H, scroll = 0) {
  // Wide enough to read a sentence on one line where it fits, and happy to take
  // most of the screen for it — the notes are short, the reading is the point.
  const w = Math.max(280, Math.min(820, VIEW_W - 40));
  // Tall enough that the whole log fits on an ordinary screen and the scrollbar
  // is for small windows rather than for everybody.
  const h = Math.max(140, Math.min(VIEW_H - 90, 780));
  const x = VIEW_W - w - 16, y = 14 + ICON + 8;
  const cols = Math.max(24, Math.floor((w - PAD * 2 - 14) / CHAR_W));

  // In PIXELS, through shared/scroll.js, like everything else that scrolls. It was
  // the fifth arrangement in the client — a line index, three lines a notch — and
  // "scroll" meaning five different things was the whole reason that module exists.
  const all = patchLines(cols);
  const room = h - HEAD_H - FOOT, span = all.length * ROW_H;
  const per = Math.max(1, Math.floor(room / ROW_H));
  const maxScroll = spanOf(span, room);
  const at = Math.max(0, Math.min(maxScroll, scroll));
  const top = y + HEAD_H;
  // Rows overhang the window on purpose and the client clips, so a line leaving the
  // top is cut rather than drawn across the header.
  const lines = rowsIn({ x: x + PAD, top, room, w: w - PAD * 2, n: all.length, rowH: ROW_H, at })
    .map(hit => ({ ...all[hit.i],
                   x: x + PAD + (all[hit.i].kind === 'note' ? 12 : 0),
                   y: hit.r.y + 11 }));

  return { panel: { x, y, w, h }, body: { x, y: top, w, h: room }, lines,
           bar: barIn({ x: x + w - 7, top, room, content: span, at, min: 18 }),
           at, per, cols, total: all.length, maxScroll };
}
