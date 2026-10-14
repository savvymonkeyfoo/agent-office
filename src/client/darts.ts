// Darts (#54): rounds of three throws, then the thrower walks up and pulls them out. A function of
// seconds since the thrower got to the throwing line, so the hand, the flights and the board agree.
import { BREAK_ROOM, DARTS_LINE, type HangoutPlace, type Point } from './layout.ts';

export const THROWS = 3;
/** Each throw: aim, let go at RELEASE_AT, fly for FLIGHT seconds into the board (#107: ~15 m/s, nearly straight). */
export const THROW_EVERY = 2.6;
export const RELEASE_AT = 1.4;
export const FLIGHT = 0.16;
/** Seconds a dart quivers after it sticks, and how far it swings at most (#107). */
export const QUIVER = 0.3;
const QUIVER_SWING = (4 * Math.PI) / 180;
const QUIVER_HZ = 12;
/** After the third throw: walk to the board, pull the darts out, walk back. */
export const WALK = 1.0;
export const PULL = 0.6;
/** Seconds to turn round: away from the board to walk back, and to face it again as the next round starts (#80). */
const TURN = 0.5;
export const ROUND = THROWS * THROW_EVERY + 2 * WALK + PULL;

/** The face of a board hung at `dartboard` (it faces +x, into the room), and how close the thrower walks up to it. */
const faceOf = (dartboard: Point) => ({ x: dartboard.x + 0.025, y: 1.6, z: dartboard.z, r: 0.3 });
export const BOARD = faceOf(BREAK_ROOM.dartboard);
export const COLLECT_FROM = 0.55;
/** How far the thrower walks from the line to collect: the board is straight ahead. */
export const COLLECT_WALK = DARTS_LINE - 0.025 - COLLECT_FROM;
/** Where each throw of a round lands on the face: up and along +z from the centre. */
const LANDINGS = [{ up: 0.06, along: -0.09 }, { up: -0.1, along: 0.03 }, { up: 0.03, along: 0.12 }];
/** The hand at the moment of release, in the thrower's own frame (forward is +z, its right is +x). */
export const RELEASE_HAND = { x: 0.4, y: 1.5, z: 0.5 };
/** Darts point along +z; the tip is this far ahead of the dart's origin, the flights this far behind. */
export const DART = { tip: 0.21, tail: 0.19 };

export interface Round {
  /** A dart in the hand, ready to throw. */
  holding: boolean;
  /** The throw in the air and how far along (0–1). */
  flying: { index: number; k: number } | null;
  /** How many darts are stuck in the board. */
  stuck: number;
  /** 0 at the throwing line, 1 up at the board (collecting). */
  walk: number;
  /** 0 facing the board, 1 turned round to walk back to the line (#80). */
  turn: number;
  /** The dart that stuck last and seconds since, while it still quivers (#107). */
  quivering: { index: number; s: number } | null;
}

const smooth = (k: number) => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };

export function dartsAt(t: number): Round {
  const r = ((t % ROUND) + ROUND) % ROUND;
  const throwing = THROWS * THROW_EVERY;
  if (r >= throwing) {
    const c = r - throwing;
    const walk = c < WALK ? c / WALK : c < WALK + PULL ? 1 : Math.max(0, 1 - (c - WALK - PULL) / WALK);
    return { holding: false, flying: null, stuck: c < WALK + PULL / 2 ? THROWS : 0, walk, turn: smooth((c - WALK - PULL) / TURN), quivering: null };
  }
  const turn = t >= ROUND ? 1 - smooth(r / TURN) : 0;
  const index = Math.floor(r / THROW_EVERY), u = r - index * THROW_EVERY;
  const flying = u >= RELEASE_AT && u < RELEASE_AT + FLIGHT ? { index, k: (u - RELEASE_AT) / FLIGHT } : null;
  const s = u - RELEASE_AT - FLIGHT;
  const quivering = s >= 0 && s < QUIVER ? { index, s } : null;
  return { holding: u < RELEASE_AT, flying, stuck: index + (s >= 0 ? 1 : 0), walk: 0, turn, quivering };
}

type Vec = { x: number; y: number; z: number };

/** A point in a thrower's own frame, in the world, for a thrower standing at `place`. */
export function fromThrower(place: HangoutPlace, p: Vec): Vec {
  const sin = Math.sin(place.yaw), cos = Math.cos(place.yaw);
  return { x: place.x + p.x * cos + p.z * sin, y: p.y, z: place.z - p.x * sin + p.z * cos };
}

/** Where throw `i`'s tip goes into the board at `dartboard`. */
export function landing(i: number, dartboard: Point = BREAK_ROOM.dartboard): Vec {
  const face = faceOf(dartboard);
  return { x: face.x, y: face.y + LANDINGS[i].up, z: face.z + LANDINGS[i].along };
}

/** A dart's origin and pointing direction `k` (0–1) of the way through throw `i` from `place` at the board at `dartboard`; at 1 it's stuck. */
export function dartFlight(place: HangoutPlace, i: number, k: number, dartboard: Point = BREAK_ROOM.dartboard) {
  // Fast enough to fly straight: the whole dart slides along the line from the hand to where it sticks (#107).
  const hand = fromThrower(place, RELEASE_HAND), to = landing(i, dartboard);
  const d = { x: to.x - hand.x, y: to.y - hand.y, z: to.z - hand.z };
  const n = Math.hypot(d.x, d.y, d.z);
  const dir = { x: d.x / n, y: d.y / n, z: d.z / n };
  // The origin sets off at the hand (the tip a dart's length ahead) and ends a dart's length short of the landing.
  // It leaves the hand at half its average speed and picks up through the flick, so it's seen leaving the hand.
  const travel = (n - DART.tip) * k * (1 + k) / 2;
  return { origin: { x: hand.x + dir.x * travel, y: hand.y + dir.y * travel, z: hand.z + dir.z * travel }, dir };
}

/** Throw `i`'s dart `s` seconds after it stuck: swinging up and down about its tip, dying away to rest by QUIVER (#107). */
export function stuckDart(place: HangoutPlace, i: number, s: number, dartboard: Point = BREAK_ROOM.dartboard) {
  const { origin, dir } = dartFlight(place, i, 1, dartboard);
  const fade = Math.max(0, 1 - s / QUIVER);
  const angle = QUIVER_SWING * fade * fade * Math.sin(2 * Math.PI * QUIVER_HZ * s);
  // Tip the direction towards straight up (the component of +y across the dart), keeping the tip where it went in.
  const across = { x: -dir.y * dir.x, y: 1 - dir.y * dir.y, z: -dir.y * dir.z };
  const m = Math.hypot(across.x, across.y, across.z);
  const cos = Math.cos(angle), sin = Math.sin(angle) / m;
  const swung = { x: dir.x * cos + across.x * sin, y: dir.y * cos + across.y * sin, z: dir.z * cos + across.z * sin };
  const tip = { x: origin.x + dir.x * DART.tip, y: origin.y + dir.y * DART.tip, z: origin.z + dir.z * DART.tip };
  return { origin: { x: tip.x - swung.x * DART.tip, y: tip.y - swung.y * DART.tip, z: tip.z - swung.z * DART.tip }, dir: swung };
}
