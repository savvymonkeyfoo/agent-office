// Hoops (#73): a shot every few seconds; the shooter jumps, lets go at the top and the ball arcs
// into the bin, where it stays until the next one lands. A function of seconds since the shooter
// got to the line, so the hands, the ball in them and the ball in the air agree.
import { BREAK_ROOM, type HangoutPlace, type Point } from './layout.ts';
import { fromThrower } from './darts.ts';

export const SHOT_EVERY = 3;
/** The hands start up at RISE_AT and let go at RELEASE_AT, the top of the jump; the ball lands FLIGHT later. */
const RISE_AT = 0.9;
export const RELEASE_AT = 1.5;
export const FLIGHT = 0.9;
/** The hands back down by then. */
const LOWERED_AT = 2.3;
const LOW = 0.85, HIGH = 1.75, JUMP = 0.25;
/** The hands hold the ball either side of it, in front of the shooter; the ball sits this far above them. */
export const HANDS = { apart: 0.19, forward: 0.3, under: 0.1 };
/** The bin's rim height and radius, and where a ball rests inside it. */
export const BIN = { rim: 0.51, r: 0.2, rest: 0.42 };
const LIFT = 0.9;

const smooth = (k: number) => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };

/** The shot `t` seconds in: how high the hands are and the jump (shooter's frame), and where the ball is. */
export function shotAt(t: number) {
  const u = ((t % SHOT_EVERY) + SHOT_EVERY) % SHOT_EVERY;
  const span = 2 * (RELEASE_AT - RISE_AT);
  const jump = u > RISE_AT && u < RISE_AT + span ? Math.sin(((u - RISE_AT) / span) * Math.PI) * JUMP : 0;
  const raise = u < RELEASE_AT ? smooth((u - RISE_AT) / (RELEASE_AT - RISE_AT)) : 1 - smooth((u - RELEASE_AT) / (LOWERED_AT - RELEASE_AT));
  const flying = u >= RELEASE_AT && u < RELEASE_AT + FLIGHT ? (u - RELEASE_AT) / FLIGHT : null;
  return { hands: LOW + (HIGH - LOW) * raise + jump, jump, holding: flying == null, flying, landed: u >= RELEASE_AT + FLIGHT };
}

/** The ball between the hands, in the shooter's frame, `t` seconds in. */
export const ballInHands = (t: number) => ({ x: 0, y: shotAt(t).hands + HANDS.under, z: HANDS.forward });

/** The ball `k` (0–1) of the way from the hands at release to resting in the bin at `bin`. */
export function ballFlight(place: HangoutPlace, k: number, bin: Point = BREAK_ROOM.bin) {
  const from = fromThrower(place, ballInHands(RELEASE_AT)), to = { x: bin.x, y: BIN.rest, z: bin.z };
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k + 4 * LIFT * k * (1 - k), z: from.z + (to.z - from.z) * k };
}
