// Fishing (#58): a cast as a function of seconds since it began. The rod swings back and forward,
// the float flies out and lands with a ripple, then bobs; on some casts (the controller decides,
// with its injectable random) one of the pond's fish comes over, bites, is lifted out over the
// jetty for a moment, and drops back in.
import { BREAK_ROOM, type HangoutPlace, type Point, type Props } from './layout.ts';
import { fishAt } from './water.ts';

export interface Cast { landing: Point; fish: number | null }
export interface Vec { x: number; y: number; z: number }

export const CAST_SECONDS = 9;
/** The rod hand, in the angler's own frame (forward +z, right +x), and the rod's length. */
export const ROD_HAND: Vec = { x: 0.1, y: 0.82, z: 0.45 };
export const ROD_LENGTH = 1.6;
const SURFACE = 0.03;
const LINE_DROP = 0.5;

/** Timeline of a cast, in seconds. The float lets go as the rod comes over the top, its tip still rising (#84). */
export const T = { back: 0.6, forward: 0.9, release: 0.66, landed: 1.6, ripple: 1.5, alert: 3, reached: 5, lift: 5.6, lifted: 6.2, drop: 7.4, back_in: 8.4, reel: 8.4 };
/** Rod angle above level: resting, drawn back over the shoulder, and lifted with a fish. */
const PITCH = { rest: 0.5, back: 1.9, lift: 1.66 };

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));
const smooth = (k: number) => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };
const mix = (a: Vec, b: Vec, k: number): Vec => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });

/** The rod's angle above level `t` seconds into a cast. */
export function rodPitch(cast: Cast, t: number) {
  if (t < T.back) return lerp(PITCH.rest, PITCH.back, smooth(t / T.back));
  if (t < T.forward) return lerp(PITCH.back, PITCH.rest, smooth((t - T.back) / (T.forward - T.back)));
  if (cast.fish == null || t < T.lift) return PITCH.rest;
  if (t < T.drop) return lerp(PITCH.rest, PITCH.lift, smooth((t - T.lift) / (T.lifted - T.lift)));
  return lerp(PITCH.lift, PITCH.rest, smooth((t - T.drop) / (T.back_in - T.drop)));
}

/** A point in the angler's own frame, in the world. */
export function fromAngler(place: HangoutPlace, p: Vec): Vec {
  const sin = Math.sin(place.yaw), cos = Math.cos(place.yaw);
  return { x: place.x + p.x * cos + p.z * sin, y: p.y, z: place.z - p.x * sin + p.z * cos };
}

/** Where the line's end hangs from the rod tip. */
const hanging = (tip: Vec): Vec => ({ ...tip, y: tip.y - LINE_DROP });

export const rodTip = (place: HangoutPlace, pitch: number) =>
  fromAngler(place, { x: ROD_HAND.x, y: ROD_HAND.y + ROD_LENGTH * Math.sin(pitch), z: ROD_HAND.z + ROD_LENGTH * Math.cos(pitch) });

export interface CastFrame {
  tip: Vec;
  /** The float, or null while a fish is hooked. */
  float: Vec | null;
  /** Where the line goes from the rod tip: the float, or the hooked fish. */
  lineEnd: Vec;
  ripple: { x: number; z: number; radius: number; opacity: number } | null;
  /** A ring where a caught fish bursts out of the water or drops back in (#109). */
  splash: { x: number; z: number; radius: number; opacity: number } | null;
  /** The fish taking part in a catch: where it is, which way it faces, its nose's angle above level, its side-to-side wriggle, and whether it shows "!!". */
  fish: CaughtFish | null;
}

export interface CaughtFish { index: number; at: Vec; heading: number; pitch: number; wriggle: number; alert: boolean }

/** Everything about a cast by an angler at `place` into `pond`, `t` seconds after it began (cast at `start` seconds on the pond's clock). */
export function castAt(cast: Cast, t: number, place: HangoutPlace, start = 0, pond: Props['pond'] = BREAK_ROOM.pond): CastFrame {
  const tip = rodTip(place, rodPitch(cast, t));
  const landing = { x: cast.landing.x, y: SURFACE, z: cast.landing.z };
  const bobbing = { ...landing, y: SURFACE + Math.sin((t - T.landed) * 3) * 0.015 };
  let float: Vec | null;
  if (t < T.release) float = hanging(tip);
  else if (t < T.landed) float = flight(cast, place, landing, t - T.release); else if (cast.fish == null) float = t < T.reel ? bobbing : mix(landing, hanging(tip), smooth((t - T.reel) / (CAST_SECONDS - T.reel)));
  else if (t < T.reached) float = bobbing;
  else if (t < T.lift) float = { ...landing, y: SURFACE - 0.06 - Math.abs(Math.sin(t * 12)) * 0.03 }; // the bite: the float dips
  else if (t < T.drop) float = null; // hooked: the line runs to the fish
  else float = hanging(tip);

  const fish = cast.fish != null && t >= T.alert && t < CAST_SECONDS ? caughtFish(cast.fish, cast, t, place, start, pond, landing) : null;
  const ripple = t >= T.landed && t < T.landed + T.ripple
    ? { x: landing.x, z: landing.z, radius: 0.08 + 0.5 * ((t - T.landed) / T.ripple), opacity: 0.8 * (1 - (t - T.landed) / T.ripple) }
    : null;
  return { tip, float, lineEnd: float ?? fish!.at, ripple, splash: cast.fish == null ? null : splashAt(cast, t, place, landing), fish };
}

const GRAVITY = 9.8;
/** The fish rises straight out at the float, nose first, for this long and this high, before the rod swings it over (#109). */
const BURST = { seconds: 0.25, height: 0.3 };
const SPLASH_SECONDS = 1;
/** Back under, it rejoins its loop by then. */
const SWUM = 8.9;
const NOSE_UP = Math.PI / 2, DIVE = -Math.PI / 3;
/** On the line it thrashes side to side, this many times a second. */
const wriggle = (t: number) => 0.35 * Math.sin(2 * Math.PI * 3 * t);

/** The drop (#109): let go of over the jetty at T.drop, it falls under gravity from rest, flung across to land at the float. */
function drop(cast: Cast, place: HangoutPlace, landing: Vec) {
  const from = hanging(rodTip(place, rodPitch(cast, T.drop)));
  const seconds = Math.sqrt((2 * (from.y - landing.y + SURFACE)) / GRAVITY);
  return { from, seconds, heading: Math.atan2(landing.x - from.x, landing.z - from.z), at: (s: number): Vec => ({ ...mix(from, landing, s / seconds), y: from.y - (GRAVITY / 2) * s * s }) };
}

/** The splash rings of a catch: one as the fish bursts out, one where it drops back in. */
function splashAt(cast: Cast, t: number, place: HangoutPlace, landing: Vec): CastFrame['splash'] {
  const ring = (since: number) => since >= 0 && since < SPLASH_SECONDS ? { x: landing.x, z: landing.z, radius: 0.1 + 0.6 * (since / SPLASH_SECONDS), opacity: 0.9 * (1 - since / SPLASH_SECONDS) } : null;
  return ring(t - T.lift) ?? ring(t - T.drop - drop(cast, place, landing).seconds);
}

/** Fish `index` in a catch, `t` seconds into the cast (from T.alert). */
function caughtFish(index: number, cast: Cast, t: number, place: HangoutPlace, start: number, pond: Props['pond'], landing: Vec): CaughtFish {
  const natural = (s: number) => { const f = fishAt(index, start + s, pond); return { at: { x: f.x, y: f.y, z: f.z }, heading: f.heading }; };
  const nearFloat = { x: landing.x, y: -0.1, z: landing.z };
  const fish = (at: Vec, heading: number, pitch = 0, wriggling = false): CaughtFish => ({ index, at, heading, pitch, wriggle: wriggling ? wriggle(t) : 0, alert: t < T.reached });
  if (t < T.reached) {
    const from = natural(T.alert).at;
    return fish(mix(from, nearFloat, smooth((t - T.alert) / (T.reached - T.alert))), Math.atan2(nearFloat.x - from.x, nearFloat.z - from.z));
  }
  const fall = drop(cast, place, landing);
  if (t < T.lift) return fish(nearFloat, fall.heading);
  if (t < T.drop) {
    const burst = { ...nearFloat, y: BURST.height }, out = (t - T.lift) / BURST.seconds;
    const at = out < 1 ? mix(nearFloat, burst, smooth(out)) : mix(burst, hanging(rodTip(place, rodPitch(cast, t))), smooth((t - T.lift - BURST.seconds) / (T.lifted - T.lift - BURST.seconds)));
    return fish(at, fall.heading, lerp(0, NOSE_UP, out), true);
  }
  const s = t - T.drop;
  if (s < fall.seconds) return fish(fall.at(s), fall.heading, lerp(NOSE_UP, DIVE, s / fall.seconds), true);
  if (t >= SWUM) return fish(natural(t).at, natural(t).heading);
  const back = natural(SWUM), k = (t - T.drop - fall.seconds) / (SWUM - T.drop - fall.seconds);
  return fish({ ...mix(landing, back.at, smooth(k)), y: Math.min(0, lerp(landing.y - SURFACE, back.at.y, smooth(k * 2))) }, Math.atan2(back.at.x - landing.x, back.at.z - landing.z), lerp(DIVE, 0, smooth(k * 2)));
}

/**
 * The float `s` seconds after release (#84): it leaves with the rod tip's vertical speed and falls
 * under the one constant gravity that brings it down on the landing point at T.landed; across, it
 * goes straight there at a steady speed.
 */
function flight(cast: Cast, place: HangoutPlace, landing: Vec, s: number): Vec {
  const tipY = (t: number) => rodTip(place, rodPitch(cast, t)).y;
  const from = { ...rodTip(place, rodPitch(cast, T.release)), y: tipY(T.release) - LINE_DROP };
  const vy = (tipY(T.release) - tipY(T.release - 1e-3)) / 1e-3, d = T.landed - T.release;
  const gravity = (2 * (from.y + vy * d - landing.y)) / (d * d);
  return { ...mix(from, landing, s / d), y: from.y + vy * s - (gravity / 2) * s * s };
}

/** Landing points stay in the pond, beyond the jetty's end (the end towards the pond) and in the rod's reach. */
export function landingFrom(random: () => number, { pond, jetty }: Pick<Props, 'pond' | 'jetty'> = BREAK_ROOM): Point {
  const towardsPond = Math.sign(pond.x - jetty.x);
  for (;;) {
    const p = { x: jetty.x + towardsPond * (jetty.w / 2 + 0.5 + random() * 1.6), z: pond.z - 0.7 + random() * 1.4 };
    if (((p.x - pond.x) / pond.rx) ** 2 + ((p.z - pond.z) / pond.rz) ** 2 < 0.6) return p;
  }
}
