// Table tennis (#70): a rally's ball follows a scripted path (no physics), so it's a function of
// time into the rally. Table-local metres: x along the table (the players stand at either end),
// z across it, y up from the floor. Side -1 is the player at the -x end, +1 the one at +x.

export type Side = -1 | 1;

/** A rally: who serves, and how many shots reach the other bat before one is missed. */
export interface Rally { server: Side; hits: number }

export const TABLE = { hx: 1.1, hz: 0.6, top: 0.77 };
export const NET_TOP = 0.925;
export const BALL_R = 0.02;
/** Players stand this far from the table's centre, at either end. */
export const PLAYER_X = 1.6;
/** Where a player hits the ball, from where they stand: in front, to the bat (right) side, and how high. */
export const HIT = { reach: 0.35, side: 0.25, y: 0.95 };

/** Seconds from one hit to the next: to the bounce on the far half, then up to the other bat. */
export const CROSS_SECONDS = 1;
const TO_BOUNCE = 0.6;
const BOUNCE_X = 0.6;
const ARC = { over: 0.25, up: 0.2, miss: 0.45 };
/** A missed ball: it bounces, flies past the end, drops and rolls away; then a short pause before the next serve. */
const PAST_END = 0.5;
const ROLL = 1;
const PAUSE = 0.8;
const MISS_SECONDS = TO_BOUNCE + PAST_END + ROLL + PAUSE;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);

export interface PongBall { x: number; y: number; z: number; visible: boolean }

/** Which side hits shot `i` of a rally: the server, then turn about. */
export const hitter = (rally: Rally, i: number): Side => (i % 2 ? -rally.server : rally.server) as Side;

/** Table-local, a point given from side `s`'s spot: `x` to its right, `y` up, `z` ahead towards the table. */
export const fromPlayer = (s: Side, p: { x: number; y: number; z: number }) => ({ x: s * (PLAYER_X - p.z), y: p.y, z: s * p.x });

/** Where side `s` hits the ball (table-local): the bat side is +z for the +x player, -z for the other. */
export const hitPoint = (s: Side) => fromPlayer(s, { x: HIT.side, y: HIT.y, z: HIT.reach });

/**
 * The serve toss (#115) comes before the rally's first hit, in the TOSS_SECONDS before time 0: the
 * free hand comes up in front with the ball on its palm, flicks it up, and it drops to the bat.
 * The scene starts each rally that early, out of the last of the previous rally's pause.
 */
export const TOSS_SECONDS = 0.7;
const TOSS = { hold: 0.25, up: 0.4, palm: 0.15, flick: 0.1 };
/** The free (left) hand, player-local as in `fromPlayer`: at rest, and up in front to toss. */
export const FREE_HAND = { x: -0.4, y: 0.7, z: 0.2 };
const TOSS_HAND = { x: -0.05, y: 0.85, z: 0.35 };

/** The server's free hand `t` seconds into a rally (player-local); at rest outside the toss. */
export function tossHand(t: number) {
  const u = t + TOSS_SECONDS;
  if (u < 0 || t >= 0) return { ...FREE_HAND };
  const mix = (a: typeof FREE_HAND, b: typeof FREE_HAND, k: number) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });
  if (u < TOSS.hold) return mix(FREE_HAND, TOSS_HAND, smooth(u / TOSS.hold));
  const k = (u - TOSS.hold) / (TOSS_SECONDS - TOSS.hold);
  const hand = mix(TOSS_HAND, FREE_HAND, smooth(k));
  return { ...hand, y: hand.y + TOSS.flick * Math.sin(Math.PI * Math.min(1, k * 2)) };
}

function tossBall(s: Side, t: number): PongBall {
  const u = Math.max(0, t + TOSS_SECONDS);
  const onPalm = (h: typeof FREE_HAND) => ({ ...fromPlayer(s, h), y: h.y + TOSS.palm });
  if (u < TOSS.hold) return { ...onPalm(tossHand(t)), visible: true };
  const from = onPalm(TOSS_HAND), to = hitPoint(s), k = (u - TOSS.hold) / (TOSS_SECONDS - TOSS.hold);
  return { x: lerp(from.x, to.x, k), y: arc(from.y, to.y, TOSS.up, k), z: lerp(from.z, to.z, k), visible: true };
}

/** Players shuffle this far across between their hits (#115), and the fist pump / looking after a missed ball. */
const SHUFFLE = 0.15;
const REACT = { from: 1, in: 0.25, out: 0.3 };

/**
 * How far side `s` has shuffled sideways from its spot (to its right, metres) `t` seconds into a rally:
 * out and back between its hits (and after the serve, and towards the ball it misses), so it's at its spot to hit.
 */
export function shuffleAt(rally: Rally, s: Side, t: number) {
  const knots = hitTimes(rally, s);
  if (rally.server !== s) knots.unshift(0);
  if (hitter(rally, rally.hits) !== s) knots.push((rally.hits + 1) * CROSS_SECONDS);
  const j = knots.findIndex((k) => k > t);
  if (j <= 0) return 0;
  const [a, b] = [knots[j - 1], knots[j]];
  return (j % 2 ? 1 : -1) * SHUFFLE * Math.sin((Math.PI * (t - a)) / (b - a));
}

/** How far into the reaction to the point (0 to 1 and back) `t` seconds into a rally: after the miss, done before the next toss. */
export function reactionAt(rally: Rally, t: number) {
  const start = (rally.hits + REACT.from) * CROSS_SECONDS, end = rallySeconds(rally) - TOSS_SECONDS;
  const k = Math.min((t - start) / REACT.in, (end - t) / REACT.out);
  return smooth(Math.min(1, Math.max(0, k)));
}

export const rallySeconds = (rally: Rally) => rally.hits * CROSS_SECONDS + MISS_SECONDS;

/** Times (seconds into the rally) when side `s` hits the ball. */
export const hitTimes = (rally: Rally, s: Side) =>
  Array.from({ length: rally.hits + 1 }, (_, i) => i).filter((i) => hitter(rally, i) === s).map((i) => i * CROSS_SECONDS);

/** A thrown ball's height: from y0 to y1, `h` above the straight line at the middle. */
const arc = (y0: number, y1: number, h: number, k: number) => lerp(y0, y1, k) + 4 * h * k * (1 - k);
const ON_TABLE = TABLE.top + BALL_R;

/** Where the ball is `t` seconds into `rally`. */
export function pongBallAt(rally: Rally, t: number): PongBall {
  if (t < 0) return tossBall(rally.server, t);
  const i = Math.min(rally.hits, Math.max(0, Math.floor(t / CROSS_SECONDS)));
  const s = hitter(rally, i), from = hitPoint(s), to = hitPoint(-s as Side);
  const u = t - i * CROSS_SECONDS;
  const bounce = { x: -s * BOUNCE_X, z: lerp(from.z, to.z, (Math.abs(from.x) + BOUNCE_X) / (Math.abs(from.x) + Math.abs(to.x))) };
  if (u < TO_BOUNCE) {
    const k = Math.max(0, u) / TO_BOUNCE;
    return { x: lerp(from.x, bounce.x, k), y: arc(from.y, ON_TABLE, ARC.over, k), z: lerp(from.z, bounce.z, k), visible: true };
  }
  if (i < rally.hits) {
    const k = Math.min(1, (u - TO_BOUNCE) / (CROSS_SECONDS - TO_BOUNCE));
    return { x: lerp(bounce.x, to.x, k), y: arc(ON_TABLE, to.y, ARC.up, k), z: lerp(bounce.z, to.z, k), visible: true };
  }
  // Missed: wide of the receiver (the side away from their bat), off the end and onto the floor, then rolling away.
  const wide = s * 0.6, drop = { x: -s * (TABLE.hx + 0.6), z: s * 0.6 };
  if (u < TO_BOUNCE + PAST_END) {
    const k = (u - TO_BOUNCE) / PAST_END;
    return { x: lerp(bounce.x, drop.x, k), y: arc(ON_TABLE, BALL_R, ARC.miss, k), z: lerp(bounce.z, wide, k), visible: true };
  }
  const k = Math.min(1, (u - TO_BOUNCE - PAST_END) / ROLL);
  const rolled = 1 - (1 - k) ** 2;
  return { x: drop.x - s * rolled * 0.8, y: BALL_R, z: drop.z, visible: u < TO_BOUNCE + PAST_END + ROLL };
}
