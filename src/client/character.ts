import * as THREE from 'three';
import type { OfficeState } from '../shared/agent.ts';
import { at, ball, cyl, mesh, tag } from './toon.ts';
import type { Look, HatKind } from './look.ts';
import { BREAK_ROOM, WALK_SPEED, rejoin, yawTowards, type HangoutPlace, type HangoutPose, type Point, type SeatSpot } from './layout.ts';
import { POSES, type BubbleKind, type Pose } from './poses.ts';
import { bubbleTexture } from './bubbles.ts';
import { CROSS_SECONDS, FREE_HAND, HIT, PLAYER_X, hitTimes, hitter, pongBallAt, rallySeconds, reactionAt, shuffleAt, tossHand, type Rally, type Side } from './pong.ts';
import { RETURN_SECONDS, driftAt, type Afloat, type Drift } from './float.ts';
import { ROD_HAND, ROD_LENGTH, rodPitch, type Cast } from './fishing.ts';
import { HANDS, shotAt } from './hoops.ts';
import { STRIKE_AT } from './pool.ts';
import { COLLECT_WALK, DART, PULL as DARTS_PULL, RELEASE_AT, RELEASE_HAND, ROUND, THROWS, THROW_EVERY, WALK as DARTS_WALK, dartsAt } from './darts.ts';
import { RELEASE_AT as BALL_RELEASE_AT } from './fetch.ts';

const SEAT_Y = 0.38;
const WOOD_DARK = '#8C6A4A';
const INK_DARK = '#3A3150';
const HIGH_FIVE_SECONDS = 1.2;
const HOP_SECONDS = 0.45;
/** A sofa cheer (#61): both fists up, pumping. */
const CHEER_SECONDS = 1.5;
const SOFA_SPOTS = ['lounge', 'couch-co-op'];
/** On the sofa the body is lifted onto the cushions, 0.56 m up, from the usual seat height (#77). */
const SOFA_LIFT = 0.17;
/** The TV remote (#113): the left hand comes up to here, pointing it at the TV; it clicks, then goes down by `end`. */
const REMOTE = { raise: 0.35, click: 0.8, end: 1.3, hand: new THREE.Vector3(-0.22, 1.2, 0.6) };
/** A leaving agent's bubble grows for this long, then vanishes (#49). */
const POP_SECONDS = 0.2;
/** Pool (#53): the cue is held level this high, over the playing surface (0.835 m); the bridge hand stops short of the table's edge, 0.85 m ahead. */
const CUE_Y = 0.9;
const BRIDGE = 0.62;
/** Pool (#76): the cue hand's distance from the strike (tip at the ball): at rest, and drawn back. */
const CUE_HAND_STRIKE = 0.16;
const CUE_REST = 0.05;
const CUE_DRAWN = 0.3;
const CUE_BRIDGE = new THREE.Vector3(0.04, CUE_Y, BRIDGE);
const CUE_STRIKE_HAND = new THREE.Vector3(0.36, CUE_Y, CUE_HAND_STRIKE);
const CUE_ALONG = CUE_BRIDGE.clone().sub(CUE_STRIKE_HAND).normalize();
/** Pool (#117): a waiting player's hand on the standing cue, and how far up the cue it grips (the butt rests on the floor). */
const CUE_STAND = { x: 0.6, y: 1.0, z: 0.12, grip: 0.6 };
const UP = new THREE.Vector3(0, 1, 0);
const BUBBLE_SIZE = 0.72;
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = REDUCED_MOTION ? 0.35 : 1;

/** `hanging` is an idle agent at a hangout place (see `place`). */
export type Mode = 'seated' | 'standing' | 'hanging' | 'walking' | 'hopping' | 'exiting' | 'gone';

const vec = (p: Point, y = 0) => new THREE.Vector3(p.x, y, p.z);

function lerpAngle(a: number, b: number, k: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Eases `a` towards `b`, no faster than MAX_TURN radians a second (#114). */
function turnTowards(a: number, b: number, dt: number) {
  const step = lerpAngle(a, b, Math.min(1, dt * 12)) - a;
  return a + Math.sign(step) * Math.min(Math.abs(step), MAX_TURN * dt);
}
const MAX_TURN = (480 * Math.PI) / 180;

/** A prototype-style cartoon agent. Builds without a DOM; speech bubbles appear when a canvas is available. */
export class Character {
  readonly root = new THREE.Group();
  mode: Mode = 'seated';
  state: OfficeState = 'working';
  bubbleKind: BubbleKind | null = null;
  seat?: SeatSpot;
  place: HangoutPlace | null = null;
  /** The floor's height under a point; every height the agent takes is above it (#103). */
  ground: (p: Point) => number = () => 0;

  readonly pivot = new THREE.Group();
  readonly head = new THREE.Group();
  private eyes: THREE.Mesh[];
  readonly hands: THREE.Mesh[];
  readonly feet: THREE.Mesh[];
  private mug = new THREE.Group();
  private snack: THREE.Mesh;
  /** Things held in the right hand for one pose: a fishing rod, dart, ball or paper plane. */
  private held = heldProps();
  private remote = remoteModel();
  /** Halloween's trick-or-treat bucket (left hand), when the theme turns it on. */
  private treats: THREE.Object3D | null = null;
  /** Pointing the remote at the TV (#113): seconds in, the click still to come, and the walk waiting for the hand to come down. */
  private remoteUse: { t: number; click: (() => void) | null; then: (() => void) | null } | null = null;
  readonly bubble: THREE.Sprite;
  private path: THREE.Vector3[] = [];
  /** Where the current walk started and the points it has passed since. */
  private trail: Point[] = [];
  private onArrive?: () => void;
  private hopTween?: { from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; yaw: number; k: number; then: () => void };
  private blinkAt = 1 + Math.random() * 3;
  private seed = Math.random() * 10;
  private walkPhase = 0;
  private exitK = 0;
  private scale = 1;
  private growing = false;
  /** Seconds left of a raised-hand high five (#33). */
  private highFiving = 0;
  /** Seconds left of a sofa cheer (#61). */
  private cheering = 0;
  /** The table-tennis rally this agent is playing (#70): which end it's at, and seconds into the rally. */
  private rally: { rally: Rally; side: Side; t: number } | null = null;
  /** How this agent's ring drifts in a pool dip (#57), and the paddle home before climbing out. */
  private drift: Drift | null = null;
  private returning: { from: Afloat; k: number; then: () => void } | null = null;
  /** The cast this angler is making (#58), and seconds into it. */
  private casting: { cast: Cast; t: number } | null = null;
  /** The paper plane being thrown (#74): seconds in, where the held plane last was, and who launches it. */
  private planeThrow: PlaneThrow | null = null;
  /** What a plane thrower is watching (#116): the target desk, then the plane in the air; and where the head points, in the world. */
  private watching: { target: THREE.Vector3; plane: (() => THREE.Vector3 | null) | null } | null = null;
  private gaze: THREE.Vector3 | null = null;
  /** Seconds since this agent last threw the dog's ball (#75). */
  private fetchThrow: number | null = null;
  /** Where the fetch ball is being thrown (#114). */
  private fetchTo: Point | null = null;
  /** Seconds into the pool turn this agent is shooting (#76). */
  private shotTime: number | null = null;
  /** Seconds since the agent got to its hangout place. */
  private placeTime = 0;
  /** Seconds since the agent started leaving; its bubble pops, then stays gone (#49). */
  private leftFor: number | null = null;

  constructor(look: Look, { trickOrTreat = false } = {}) {
    this.root.add(this.pivot);
    const body = mesh(new THREE.CapsuleGeometry(0.36, 0.3, 8, 20), look.shirt);
    body.position.y = 0.53;
    body.scale.set(1, 1, 0.92);
    this.pivot.add(body);
    const apron = mesh(new THREE.CapsuleGeometry(0.3, 0.12, 6, 16), '#FFF8EC', { outline: 0.03 });
    apron.position.set(0, 0.42, 0.12);
    apron.scale.set(0.95, 0.9, 0.7);
    this.pivot.add(apron);

    this.head.position.y = 1.27;
    this.pivot.add(this.head);
    this.head.add(ball(0.38, look.skin));
    this.eyes = [-1, 1].map((side) => {
      const eye = at(new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: '#241C2F' })), 0.13 * side, 0.04, 0.345);
      eye.scale.set(0.85, 1.25, 0.5);
      eye.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: '#FFFFFF' })), 0.015, 0.02, 0.04));
      this.head.add(eye);
      return eye;
    });
    for (const side of [-1, 1]) {
      const cheek = at(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: '#F49AA0' })), 0.23 * side, -0.08, 0.3);
      cheek.scale.set(1.3, 0.75, 0.4);
      this.head.add(cheek);
    }
    const mouth = at(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: '#241C2F' })), 0, -0.1, 0.365);
    mouth.rotation.z = Math.PI;
    this.head.add(mouth);
    this.head.add(hat(look.hat, look.hatColor));

    this.hands = [0, 1].map(() => {
      const hand = ball(0.12, look.skin, { outline: 0.08 });
      this.root.add(hand);
      return hand;
    });
    this.feet = [0, 1].map(() => {
      const foot = ball(0.12, '#3A3150', { outline: 0.08 });
      foot.scale.set(1, 0.6, 1.35);
      this.root.add(foot);
      return foot;
    });

    this.mug.add(cyl(0.08, 0.07, 0.15, '#FFFFFF', { outline: 0.08 }));
    const handle = mesh(new THREE.TorusGeometry(0.045, 0.015, 6, 12), '#FFFFFF', { outline: 0.1 });
    handle.position.x = 0.09;
    this.mug.add(handle);
    this.mug.position.set(0.04, 0.1, 0.06);
    this.hands[1].add(this.mug);
    this.snack = mesh(new THREE.BoxGeometry(0.2, 0.08, 0.14), '#E2B347', { outline: 0.06 });
    this.snack.position.set(-0.02, 0.1, 0.06);
    this.hands[0].add(this.snack);
    for (const prop of Object.values(this.held)) this.hands[1].add(prop);
    this.hands[0].add(this.remote);
    if (trickOrTreat) this.hands[0].add((this.treats = treatBucket()));

    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    this.bubble.center.set(0.5, 0);
    this.bubble.scale.set(BUBBLE_SIZE, BUBBLE_SIZE, 1);
    this.bubble.renderOrder = 10;
    this.root.add(this.bubble);
  }

  get pose(): Pose | HangoutPose | 'walking' {
    if (this.mode === 'seated') return POSES[this.state].pose;
    if (this.mode === 'standing') return 'standing';
    if (this.mode === 'hanging') return this.place!.pose;
    return 'walking';
  }

  /** Place straight at the desk (agents already there when the page opens). */
  sitAt(seat: SeatSpot, state: OfficeState) {
    this.seat = seat;
    this.state = state;
    this.settle();
  }

  /** Place straight at a hangout spot (idle agents already there when the page opens). */
  placeAt(seat: SeatSpot, state: OfficeState, place: HangoutPlace) {
    this.seat = seat;
    this.state = state;
    this.hangAt(place);
  }

  /** Walk along `path` to a hangout `place`, or back to the desk when it's null. */
  go(path: Point[], place: HangoutPlace | null) {
    if (!place) this.setOff(path, path.length - 1, () => this.hopToPlace());
    else if (place.sits) this.setOff(path, path.length - 1, () => this.hop(this.above(place, SEAT_Y), place.yaw, () => this.hangAt(place)));
    else this.setOff(path, path.length, () => this.hangAt(place));
  }

  /** Walk in from the door along `path` (which ends at the seat), then sit down. */
  arrive(seat: SeatSpot, state: OfficeState, path: Point[]) {
    this.seat = seat;
    this.state = state;
    this.root.position.copy(this.above(path[0]));
    this.scale = 0.01;
    this.growing = true;
    this.walk(path.slice(1, -1), () => this.hopToPlace());
  }

  setState(state: OfficeState) {
    this.state = state;
    if (this.mode === 'seated' && state === 'finished') this.hopToPlace();
    else if (this.mode === 'standing' && state !== 'finished') this.hopToPlace();
  }

  /** Which way it faces in its chair: in the control room, one with a question swivels round to the room. */
  private seatedYaw() {
    const seat = this.seat!;
    return this.state === 'needs' && seat.askYaw !== undefined ? seat.askYaw : seat.yaw;
  }

  /** A table-tennis rally starts now, `from` seconds into it, with this agent at end `side` (#70); null: play stopped. */
  playRally(rally: Rally | null, side: Side, from = 0) {
    this.rally = rally && { rally, side, t: from };
  }

  /** This agent's pool turn starts now (#76): it strikes at STRIKE_AT. */
  takeShot() {
    this.shotTime = 0;
  }

  /** How its ring will drift once this agent is afloat in a pool dip (#57). */
  float(drift: Drift) {
    this.drift = drift;
  }

  /** Afloat in a pool dip: how far the ring is from home, turned and bobbing (#57); null otherwise. */
  floatOffset(): Afloat | null {
    if (this.mode !== 'hanging' || this.place?.pose !== 'floating') return null;
    const still = { x: 0, z: 0, spin: 0, bob: 0 };
    if (this.returning) {
      const { from, k } = this.returning, left = 1 - k * k * (3 - 2 * k);
      return { x: from.x * left, z: from.z * left, spin: from.spin, bob: from.bob * left };
    }
    return this.drift ? driftAt(this.drift, this.placeTime) : still;
  }

  /** A new cast starts now (#58). */
  fish(cast: Cast) {
    this.casting = { cast, t: 0 };
  }

  /**
   * Throw a paper plane now (#74); `release` launches it from where the held plane was, as the arm lets go,
   * and may return where the plane is while it flies. The thrower eyes `target` and then watches the plane (#116).
   */
  throwPlane(release: PlaneRelease, target?: THREE.Vector3) {
    this.planeThrow = { t: 0, from: null, release };
    this.watching = target ? { target, plane: null } : null;
  }

  /** A fetch starts now: throw the dog's ball (#75) towards `to`, turning to face it first (#114). */
  throwBall(to: Point) {
    this.fetchThrow = 0;
    this.fetchTo = to;
  }

  /** Which way to face playing fetch: towards the throw until the follow-through ends, then back to the dog (#114). */
  private fetchYaw(place: HangoutPlace) {
    const throwing = this.fetchThrow != null && this.fetchTo && this.fetchThrow < BALL_RELEASE_AT + BALL_FOLLOW_THROUGH;
    return throwing ? yawTowards(this.root.position, this.fetchTo!) : place.yaw;
  }

  /** Playing fetch with the dog (#75). */
  throwingBall() {
    return this.mode === 'hanging' && this.place?.pose === 'throwing-ball';
  }

  /** Fishing from the jetty (#58). */
  fishing() {
    return this.mode === 'hanging' && this.place?.pose === 'fishing';
  }

  /** At the darts line (#54): where, and seconds since arriving there (the board's darts follow it). */
  dartsThrower() {
    return this.mode === 'hanging' && this.place?.pose === 'throwing-darts' ? { place: this.place, t: this.placeTime } : null;
  }

  /** At the hoops line (#73): where, and seconds since arriving there (the ball in the air follows it). */
  hoopsShooter() {
    return this.mode === 'hanging' && this.place?.pose === 'shooting-hoops' ? { place: this.place, t: this.placeTime } : null;
  }

  /** Sitting on the lounge sofa, watching TV or playing (#61). */
  onSofa() {
    return this.mode === 'hanging' && SOFA_SPOTS.includes(this.place!.spot);
  }

  /** Point the remote at the TV (#113): `click` switches it as the hand is up; walking off waits for the hand to come down. */
  useRemote(click: () => void) {
    this.remoteUse = { t: 0, click, then: this.remoteUse?.then ?? null };
    this.remote.visible = true;
  }

  usingRemote() {
    return !!this.remoteUse;
  }

  /** Fist-pump with everyone else on the sofa (#61). */
  cheer() {
    this.cheering = CHEER_SECONDS;
  }

  /** Raise a hand for a high five (#33), whatever the agent is doing. */
  highFive() {
    this.highFiving = HIGH_FIVE_SECONDS;
  }

  /** Walk out along `path` (from wherever the agent is to the door), then disappear. */
  leave(path: Point[]) {
    this.leftFor = 0;
    this.setOff(path, path.length, () => { this.mode = 'exiting'; this.exitK = 0; });
  }

  /**
   * Start along `path` (whose first point is where the agent is, or a point behind it on the leg
   * it's walking) and walk up to point `end`: hop off a chair or sofa first, or turn round mid-walk.
   */
  private setOff(path: Point[], end: number, then: () => void) {
    if (this.remoteUse) {
      this.remoteUse.then = () => this.setOff(path, end, then);
      return;
    }
    const afloat = this.floatOffset();
    if (afloat && (afloat.x || afloat.z) && !this.returning) {
      // Paddle back to the ring's home spot first (#57).
      this.returning = { from: afloat, k: 0, then: () => { this.returning = null; this.drift = null; this.setOff(path, end, then); } };
      return;
    }
    const walkFrom = (from: number) => this.walk(path.slice(from, end), then);
    const offFurniture = this.mode === 'seated' || this.mode === 'standing' || (this.mode === 'hanging' && this.place!.sits);
    if (offFurniture) this.hop(this.above(path[1] ?? path[0]), this.root.rotation.y, () => walkFrom(2));
    else if (this.mode === 'hanging') walkFrom(1);
    else if (this.mode === 'hopping') this.hopTween!.then = () => walkFrom(0);
    else if (this.mode === 'walking') this.walk(rejoin(this.root.position, this.trail, this.path, path.slice(0, end)), then);
    else walkFrom(0);
    this.place = null;
    this.rally = null;
    this.casting = null;
    this.planeThrow = null;
    this.watching = null;
    this.gaze = null;
    this.fetchThrow = null;
    this.fetchTo = null;
    this.shotTime = null;
  }

  private hangAt(place: HangoutPlace) {
    this.place = place;
    this.mode = 'hanging';
    this.placeTime = 0;
    this.root.position.copy(this.above(place, place.sits ? SEAT_Y : 0));
    this.root.rotation.y = place.yaw;
  }

  private settle() {
    const seat = this.seat!;
    const standing = this.state === 'finished';
    this.mode = standing ? 'standing' : 'seated';
    this.root.position.copy(standing ? this.above(seat.standSpot) : this.above(seat.sit, SEAT_Y));
    this.root.rotation.y = standing ? 0 : this.seatedYaw();
  }

  private hopToPlace() {
    const seat = this.seat!;
    const standing = this.state === 'finished';
    this.hop(standing ? this.above(seat.standSpot) : this.above(seat.sit, SEAT_Y), standing ? 0 : this.seatedYaw(), () => this.settle());
  }

  /** `y` above the floor at `p`. */
  private above(p: Point, y = 0) {
    return vec(p, this.ground(p) + y);
  }

  private hop(to: THREE.Vector3, yaw: number, then: () => void) {
    this.mode = 'hopping';
    this.hopTween = { from: this.root.position.clone(), to, fromYaw: this.root.rotation.y, yaw, k: 0, then };
  }

  private walk(points: Point[], then: () => void) {
    this.mode = 'walking';
    this.trail = [{ x: this.root.position.x, z: this.root.position.z }];
    this.path = points.map((p) => vec(p));
    this.onArrive = then;
  }

  update(t: number, dt: number) {
    if (this.mode === 'gone') return;
    const p = this.pivot, head = this.head, [hl, hr] = this.hands, [fl, fr] = this.feet;
    const tt = t + this.seed;
    p.position.set(0, 0, 0);
    p.rotation.set(0, 0, 0);
    p.scale.set(1, 1, 1);
    head.rotation.set(0, 0, 0);
    this.mug.visible = false;
    this.snack.visible = false;
    for (const prop of Object.values(this.held)) prop.visible = false;
    this.remote.visible = false;
    if (this.treats) this.treats.visible = false;
    // Every agent keeps its state's bubble, wherever it is, until it pops on leaving.
    if (this.leftFor != null) this.leftFor += dt;
    if (this.shotTime != null) this.shotTime += dt;
    const popping = this.leftFor != null && this.leftFor < POP_SECONDS;
    const bubble: BubbleKind | null = this.leftFor == null || popping ? POSES[this.state].bubble : null;
    this.bubble.scale.setScalar(BUBBLE_SIZE * (popping ? 1 + (this.leftFor! / POP_SECONDS) * 0.5 : 1));
    let bubbleY = 2.2;

    this.blinkAt -= dt;
    const blinking = this.blinkAt < 0;
    if (this.blinkAt < -0.12) this.blinkAt = 2 + Math.random() * 4;
    this.eyes.forEach((e) => { e.scale.y = blinking ? 0.15 : 1.25; });

    if (this.growing) {
      this.scale = Math.min(1, this.scale + dt * 2.5);
      if (this.scale >= 1) this.growing = false;
    }
    if (this.mode === 'walking' || this.mode === 'hopping' || this.mode === 'exiting') this.locomote(dt);

    if (this.mode === 'seated') {
      this.root.rotation.y = lerpAngle(this.root.rotation.y, this.seatedYaw(), Math.min(1, dt * 5)); // swivels round
      fl.position.set(-0.16, -0.24, 0.34);
      fr.position.set(0.16, -0.24, 0.34);
      const pose = POSES[this.state].pose;
      if (pose === 'typing') {
        p.position.y = Math.sin(tt * 9) * 0.012 * motion;
        head.rotation.x = 0.14 + Math.sin(tt * 1.3) * 0.04 * motion;
        head.rotation.y = Math.sin(tt * 0.7) * 0.08 * motion;
        hl.position.set(-0.2, 0.5 + Math.max(0, Math.sin(tt * 15)) * 0.07 * motion, 0.62);
        hr.position.set(0.2, 0.5 + Math.max(0, Math.sin(tt * 15 + Math.PI)) * 0.07 * motion, 0.62);
      } else if (pose === 'waving') {
        p.rotation.z = Math.sin(tt * 3) * 0.07 * motion;
        head.rotation.z = Math.sin(tt * 3) * 0.08 * motion;
        head.rotation.x = -0.12;
        hl.position.set(-0.22, 0.5, 0.58);
        hr.position.set(0.44 + Math.sin(tt * 10) * 0.09 * motion, 1.62 + Math.abs(Math.sin(tt * 10)) * 0.04, 0.12);
        bubbleY = 2.3 + Math.abs(Math.sin(tt * 3.2)) * 0.12 * motion;
      } else if (pose === 'sipping') {
        p.rotation.x = -0.15;
        const sipping = (tt % 6) / 6 < 0.22;
        head.rotation.x = sipping ? -0.28 : -0.05;
        hl.position.set(-0.32, 0.45, 0.28);
        hr.position.lerp(sipping ? new THREE.Vector3(0.1, 1.08, 0.42) : new THREE.Vector3(0.34, 0.62, 0.36), Math.min(1, dt * 8));
        this.mug.visible = true;
        bubbleY = 2.2 + Math.sin(tt * 1.6) * 0.04 * motion;
      } else if (pose === 'slumped') {
        p.rotation.x = 0.42;
        p.scale.y = 1 + Math.sin(tt * 1.4) * 0.025 * motion;
        head.rotation.x = 0.4;
        head.rotation.z = 0.25;
        hl.position.set(-0.38, 0.48, 0.6);
        hr.position.set(0.38, 0.48, 0.6);
        bubbleY = 2.0 + ((tt * 0.25) % 1) * 0.25 * motion;
      }
    } else if (this.mode === 'standing') {
      const hopT = (tt % 3.2) / 3.2;
      const hopY = hopT < 0.16 ? Math.sin((hopT / 0.16) * Math.PI) * 0.22 * motion : 0;
      this.root.position.y = this.ground(this.root.position) + hopY;
      p.scale.y = hopT > 0.16 && hopT < 0.22 ? 0.92 : 1;
      hl.position.set(-0.47, 0.6 + hopY * 0.6, 0.06);
      hr.position.set(0.47, 0.6 + hopY * 0.6 + (hopY > 0 ? 0.25 : 0), 0.06);
      fl.position.set(-0.17, 0.06, 0.04);
      fr.position.set(0.17, 0.06, 0.04);
      head.rotation.x = -0.1;
      bubbleY = 2.15 + hopY;
    } else if (this.mode === 'hanging') {
      bubbleY = this.hangingPose(this.place!, tt, dt);
    }

    if (this.remoteUse) this.pointRemote(dt);
    if (this.cheering > 0) {
      this.cheering -= dt;
      const pump = Math.abs(Math.sin(this.cheering * 9)) * 0.15 * motion;
      // Fists over the head, not out to the sides, clear of a neighbour on the sofa (#112).
      hl.position.set(-0.22, 1.7 + pump, 0.15);
      hr.position.set(0.22, 1.7 + pump, 0.15);
    }
    if (this.highFiving > 0) {
      this.highFiving -= dt;
      hr.position.set(0.3, 1.8 + Math.sin(this.highFiving * 12) * 0.05 * motion, 0.25);
    }
    if (this.treats) this.trickOrTreat(tt);

    this.bubbleKind = bubble;
    const texture = bubble && bubbleTexture(bubble);
    this.bubble.visible = !!texture;
    if (texture) {
      this.bubble.material.map = texture;
      this.bubble.material.needsUpdate = true;
      this.bubble.position.set(0.32, bubbleY, 0);
    }
    this.root.scale.setScalar(this.scale);
  }

  /** Halloween: the bucket comes along on walks and visits, and is held out at someone's desk for treats. */
  private trickOrTreat(tt: number) {
    const pose = this.mode === 'hanging' ? this.place?.pose : null;
    if (this.mode !== 'walking' && pose !== 'watching' && pose !== 'chatting' && pose !== 'delivering') return;
    this.treats!.visible = true;
    if (pose === 'watching') this.hands[0].position.set(-0.22, 0.95 + Math.abs(Math.sin(tt * 2.5)) * 0.08 * motion, 0.5);
  }

  /** Poses at a hangout place; returns the bubble height. */
  private hangingPose(place: HangoutPlace, tt: number, dt: number) {
    const p = this.pivot, head = this.head, [hl, hr] = this.hands, [fl, fr] = this.feet;
    this.placeTime += dt;
    if (place.pose === 'throwing-ball') this.root.rotation.y = turnTowards(this.root.rotation.y, this.fetchYaw(place), dt);
    else this.root.rotation.y = lerpAngle(this.root.rotation.y, place.yaw, Math.min(1, dt * 8));
    if (place.pose === 'throwing-darts') this.collectDarts(place);
    if (place.pose === 'floating') this.drifting(place, dt);
    if (place.pose === 'paddle') this.footwork(place);
    if (place.pose === 'lounging') {
      fl.position.set(-0.16, -0.24, 0.34);
      fr.position.set(0.16, -0.24, 0.34);
      p.position.y = SOFA_LIFT;
      p.rotation.x = -0.15;
      head.rotation.x = -0.1 + Math.sin(tt * 0.8) * 0.05 * motion;
      // Hands kept in front, inside the shoulders, so a neighbour on the sofa has room (#112).
      hl.position.set(-0.24, 0.5, 0.42);
      hr.position.set(0.26, 0.6, 0.38);
      this.mug.visible = true;
      return 2.1;
    }
    fl.position.set(-0.17, 0.06, 0.04);
    fr.position.set(0.17, 0.06, 0.04);
    const activity = ACTIVITY_POSES[place.pose];
    if (activity) {
      const held = this.held[place.pose];
      if (held) held.visible = true;
      if (this.rally) this.rally.t += dt;
      if (this.casting) this.casting.t += dt;
      if (this.planeThrow) this.planeThrow.t += dt;
      if (this.fetchThrow != null) this.fetchThrow += dt;
      const bubbleY = activity({ fetchThrow: this.fetchThrow, casting: this.casting, pivot: p, head, hands: this.hands, feet: this.feet, held, rally: this.rally, placeTime: this.placeTime, planeThrow: this.planeThrow, shotTime: this.shotTime }, tt);
      if (place.pose === 'throwing-plane') {
        this.letGoOfPlane(held!);
        this.watchPlane(dt);
      }
      return bubbleY;
    }
    if (place.pose === 'chatting') {
      const talk = Math.sin(tt * 6);
      p.position.y = Math.abs(Math.sin(tt * 3)) * 0.03 * motion;
      head.rotation.x = Math.sin(tt * 2.4) * 0.12 * motion;
      head.rotation.z = Math.sin(tt * 1.3) * 0.08 * motion;
      hl.position.set(-0.42, 0.75 + Math.max(0, talk) * 0.18 * motion, 0.22);
      hr.position.set(0.42, 0.75 + Math.max(0, -talk) * 0.18 * motion, 0.22);
    } else {
      const eating = place.pose === 'eating';
      const bite = (tt % 4) / 4 < 0.25;
      const hand = eating ? hl : hr;
      (eating ? hr : hl).position.set(eating ? 0.47 : -0.47, 0.6, 0.06);
      hand.position.lerp(bite ? new THREE.Vector3(eating ? -0.1 : 0.1, 1.08, 0.42) : new THREE.Vector3(eating ? -0.36 : 0.36, 0.66, 0.34), Math.min(1, dt * 8));
      head.rotation.x = bite ? -0.2 : 0;
      (eating ? this.snack : this.mug).visible = true;
    }
    return 2.2 + Math.sin(tt * 1.6) * 0.04 * motion;
  }

  /** The left hand raises the remote toward the TV, clicks it, and lowers it again; then any waiting walk starts (#113). */
  private pointRemote(dt: number) {
    const use = this.remoteUse!;
    use.t += dt;
    if (use.t >= REMOTE.click && use.click) { use.click(); use.click = null; }
    if (use.t >= REMOTE.end) {
      this.remoteUse = null;
      use.then?.();
      return;
    }
    const k = Math.min(1, use.t / REMOTE.raise, (REMOTE.end - use.t) / (REMOTE.end - REMOTE.click));
    this.hands[0].position.lerp(REMOTE.hand, k * k * (3 - 2 * k));
    this.remote.visible = true;
  }

  /** Paper planes (#74): note where the held plane is until the arm lets go, then launch it from there. */
  private letGoOfPlane(held: THREE.Object3D) {
    const thrown = this.planeThrow;
    if (!thrown) return;
    if (thrown.t < PLANE_ARM.release) thrown.from = held.getWorldPosition(new THREE.Vector3());
    else if (thrown.release) {
      const flying = thrown.release(thrown.from ?? held.getWorldPosition(new THREE.Vector3()));
      if (this.watching && flying) this.watching.plane = flying;
      thrown.release = null;
    }
    if (thrown.t >= PLANE_ARM.end) this.planeThrow = null;
  }

  /**
   * Paper planes (#116): turn the head toward the target desk, then the plane while it flies, then back to the usual pose.
   * The head turns at most HEAD_TURN from the body; the upper body twists for the rest.
   */
  private watchPlane(dt: number) {
    const flying = this.watching?.plane?.() ?? null;
    if (this.watching?.plane && !flying) this.watching = null;
    const eye = this.head.getWorldPosition(new THREE.Vector3());
    const usual = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(this.head.rotation.x, this.root.rotation.y + this.pivot.rotation.y, 0, 'YXZ'));
    const wanted = this.watching ? (flying ?? this.watching.target).clone().sub(eye).normalize() : usual;
    if (!this.gaze) {
      if (!this.watching) return;
      this.gaze = usual;
    }
    const gaze = this.gaze;
    turnToward(gaze, wanted, 1 - Math.exp(-dt * GAZE_RATE));
    if (flying && gaze.angleTo(wanted) > GAZE_LAG) turnToward(gaze, wanted, 1 - GAZE_LAG / gaze.angleTo(wanted));
    if (!this.watching && gaze.angleTo(usual) < 0.002) {
      this.gaze = null;
      return;
    }
    const turn = lerpAngle(0, Math.atan2(gaze.x, gaze.z) - this.root.rotation.y, 1);
    const headTurn = THREE.MathUtils.clamp(lerpAngle(0, turn - this.pivot.rotation.y, 1), -HEAD_TURN, HEAD_TURN);
    this.pivot.rotation.y = turn - headTurn;
    this.head.quaternion.setFromEuler(new THREE.Euler(-Math.asin(THREE.MathUtils.clamp(gaze.y, -1, 1)), headTurn, 0, 'YXZ'));
  }

  /** Pool dip (#57): the ring carries the rider about, turning and bobbing; or paddles it home before climbing out. */
  private drifting(place: HangoutPlace, dt: number) {
    if (this.returning) {
      this.returning.k = Math.min(1, this.returning.k + dt / RETURN_SECONDS);
      if (this.returning.k >= 1) return this.returning.then();
    }
    const afloat = this.floatOffset()!;
    this.root.position.copy(this.above({ x: place.x + afloat.x, z: place.z + afloat.z }, SEAT_Y + afloat.bob * motion));
    this.root.rotation.y = place.yaw + afloat.spin;
  }

  /** Table tennis (#115): shuffling sideways between hits; after missing a point, turning to look where the ball went. */
  private footwork(place: HangoutPlace) {
    const r = this.rally;
    const across = r ? shuffleAt(r.rally, r.side, r.t) : 0;
    this.root.position.copy(this.above({ x: place.x + Math.cos(place.yaw) * across, z: place.z - Math.sin(place.yaw) * across }));
    if (!r || hitter(r.rally, r.rally.hits) === r.side) return;
    const ball = pongBallAt(r.rally, (r.rally.hits + 2) * CROSS_SECONDS);
    const towardsBall = Math.atan2(ball.x - r.side * PLAYER_X, ball.z);
    this.root.rotation.y = lerpAngle(place.yaw, towardsBall, reactionAt(r.rally, r.t));
  }

  /** Darts (#54): after a round, walk up to the board to pull the darts out, then back to the line. */
  private collectDarts(place: HangoutPlace) {
    const { walk, turn } = dartsAt(this.placeTime);
    const step = COLLECT_WALK * walk;
    this.root.position.copy(this.above({ x: place.x + Math.sin(place.yaw) * step, z: place.z + Math.cos(place.yaw) * step }));
    this.root.rotation.y = place.yaw + Math.PI * turn;
  }

  private locomote(dt: number) {
    const p = this.pivot, [hl, hr] = this.hands, [fl, fr] = this.feet;
    if (this.mode === 'hopping') {
      const w = this.hopTween!;
      w.k = Math.min(1, w.k + dt / HOP_SECONDS);
      const e = w.k < 0.5 ? 2 * w.k * w.k : 1 - Math.pow(-2 * w.k + 2, 2) / 2;
      this.root.position.lerpVectors(w.from, w.to, e);
      this.root.position.y += Math.sin(w.k * Math.PI) * 0.45;
      this.root.rotation.y = lerpAngle(w.fromYaw, w.yaw, e);
      p.scale.set(1 - Math.sin(w.k * Math.PI) * 0.06, 1 + Math.sin(w.k * Math.PI) * 0.1, 1);
      hl.position.set(-0.5, 0.95, 0.05);
      hr.position.set(0.5, 0.95, 0.05);
      fl.position.set(-0.17, 0.04, 0.04);
      fr.position.set(0.17, 0.04, 0.04);
      if (w.k >= 1) w.then();
      return;
    }
    if (this.mode === 'exiting') {
      this.exitK += dt / 0.5;
      this.scale = Math.max(0, 1 - this.exitK);
      this.root.position.z -= dt * 0.8;
      if (this.exitK >= 1) { this.mode = 'gone'; this.root.visible = false; }
      return;
    }
    const target = this.path[0];
    if (!target) {
      const then = this.onArrive;
      this.onArrive = undefined;
      then?.();
      return;
    }
    const pos = this.root.position;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) {
      this.trail.push(this.path.shift()!);
      return;
    }
    const step = Math.min(dist, WALK_SPEED * dt);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    this.root.rotation.y = lerpAngle(this.root.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));
    this.walkPhase += dt * 11;
    const s = Math.sin(this.walkPhase);
    pos.y = this.ground(pos) + Math.abs(s) * 0.09 * motion;
    p.rotation.z = s * 0.09 * motion;
    p.rotation.x = 0.08;
    fl.position.set(-0.17, 0.06 + Math.max(0, s) * 0.1, 0.04 + s * 0.16);
    fr.position.set(0.17, 0.06 + Math.max(0, -s) * 0.1, 0.04 - s * 0.16);
    hl.position.set(-0.47, 0.6, 0.06 - s * 0.2);
    hr.position.set(0.47, 0.6, 0.06 + s * 0.2);
  }
}

function hat(kind: HatKind, color: string) {
  const g = new THREE.Group();
  const dome = (r: number, frac: number, c: string) =>
    mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI * frac), c, { outline: 0.04 });
  if (kind === 'headphones') {
    g.add(at(dome(0.395, 0.42, '#4A3A2E'), 0, 0.01, 0));
    g.add(mesh(new THREE.TorusGeometry(0.41, 0.045, 8, 32, Math.PI), color, { outline: 0.06 }));
    for (const side of [-1, 1]) {
      const cup = at(cyl(0.12, 0.12, 0.1, color, { outline: 0.06 }), 0.41 * side, 0, 0);
      cup.rotation.z = Math.PI / 2;
      g.add(cup);
    }
  } else if (kind === 'cap') {
    g.add(at(dome(0.405, 0.5, color), 0, 0.03, 0));
    const brim = at(cyl(0.26, 0.26, 0.04, color, { outline: 0.06 }), 0, 0.08, 0.34);
    brim.scale.set(1, 1, 0.8);
    g.add(brim);
    g.add(at(ball(0.05, '#FFFFFF', { outline: 0.1 }), 0, 0.43, 0));
  } else if (kind === 'beanie') {
    g.add(at(dome(0.415, 0.5, color), 0, 0.02, 0));
    const rim = mesh(new THREE.TorusGeometry(0.39, 0.07, 10, 32), '#FFF8EC', { outline: 0.05 });
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.06;
    g.add(rim);
    g.add(at(ball(0.1, '#FFF8EC'), 0, 0.46, 0));
  } else if (kind === 'chef') {
    g.add(at(cyl(0.3, 0.27, 0.32, '#FFFFFF'), 0, 0.42, 0));
    for (const [x, y, z, r] of [[0, 0.66, 0, 0.2], [0.17, 0.62, 0.05, 0.16], [-0.17, 0.62, 0.05, 0.16], [0, 0.62, -0.16, 0.16]]) {
      g.add(at(ball(r, '#FFFFFF'), x, y, z));
    }
  } else if (kind === 'witch') {
    g.add(at(dome(0.395, 0.42, '#4A3A2E'), 0, 0.01, 0));
    g.add(at(cyl(0.6, 0.6, 0.04, color, { outline: 0.05 }), 0, 0.3, 0));
    const cone = at(mesh(new THREE.ConeGeometry(0.32, 0.75, 20), color, { outline: 0.05 }), 0, 0.68, 0);
    cone.rotation.z = 0.18;
    g.add(cone);
    g.add(at(cyl(0.33, 0.33, 0.07, '#FF8A1F'), 0, 0.36, 0));
  } else if (kind === 'crown') {
    g.add(at(dome(0.395, 0.42, '#4A3A2E'), 0, 0.01, 0));
    g.add(at(cyl(0.32, 0.3, 0.16, color, { outline: 0.05 }), 0, 0.36, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.add(at(mesh(new THREE.ConeGeometry(0.07, 0.18, 8), color, { outline: 0.05 }), Math.sin(a) * 0.29, 0.52, Math.cos(a) * 0.29));
      g.add(at(ball(0.035, '#E0475A'), Math.sin(a) * 0.32, 0.37, Math.cos(a) * 0.32));
    }
  } else if (kind === 'tuft') {
    g.add(at(dome(0.395, 0.45, color), 0, 0.01, 0));
    for (const [x, y, z, r] of [[0, 0.4, 0.12, 0.09], [0.08, 0.43, 0.05, 0.08], [-0.07, 0.42, 0.02, 0.07]]) {
      g.add(at(ball(r, color), x, y, z));
    }
  } else {
    g.add(at(dome(0.4, 0.5, color), 0, 0.01, 0));
    g.add(at(ball(0.16, color), 0, 0.46, -0.12));
  }
  return g;
}

interface Body {
  pivot: THREE.Group; head: THREE.Group; hands: THREE.Mesh[]; feet: THREE.Mesh[]; held?: THREE.Object3D;
  rally?: { rally: Rally; side: Side; t: number } | null;
  /** Seconds since arriving at the place. */
  placeTime?: number;
  casting?: { cast: Cast; t: number } | null;
  planeThrow?: PlaneThrow | null;
  fetchThrow?: number | null;
  /** Seconds into this agent's pool turn (#76). */
  shotTime?: number | null;
}

/** Launches a paper plane from `from`; may return where it is while it flies, null once landed (#116). */
type PlaneRelease = (from: THREE.Vector3) => (() => THREE.Vector3 | null) | void;
interface PlaneThrow { t: number; from: THREE.Vector3 | null; release: PlaneRelease | null }

/** A plane thrower's gaze (#116): how fast it turns toward what it watches, how far behind a flying plane it may trail, and the head's furthest turn from the body. */
const GAZE_RATE = 9;
const GAZE_LAG = 12 * (Math.PI / 180);
const HEAD_TURN = 75 * (Math.PI / 180);

/** Turns unit vector `v` a fraction `k` of the way toward unit vector `to`. */
function turnToward(v: THREE.Vector3, to: THREE.Vector3, k: number) {
  const q = new THREE.Quaternion().setFromUnitVectors(v, to);
  v.applyQuaternion(new THREE.Quaternion().slerp(q, k)).normalize();
}

/** Paper planes (#74): the throwing hand and body twist at moments of a throw, eased between; it lets go at `release`. */
const PLANE_KEYS = [
  { t: 0, hand: new THREE.Vector3(0.35, 1.15, 0.2), twist: 0 },
  { t: 0.45, hand: new THREE.Vector3(0.35, 1.3, -0.1), twist: -0.2 },
  { t: 0.65, hand: new THREE.Vector3(0.25, 1.35, 0.55), twist: 0.1 },
  { t: 1.3, hand: new THREE.Vector3(0.35, 1.15, 0.2), twist: 0 },
];
const PLANE_ARM = { release: PLANE_KEYS[2].t, end: PLANE_KEYS[3].t };

/** The throwing hand and twist `t` seconds into a paper-plane throw. */
function planeArm(t: number) {
  const i = PLANE_KEYS.findIndex((key) => key.t > t);
  if (i <= 0) return PLANE_KEYS[i < 0 ? PLANE_KEYS.length - 1 : 0];
  const a = PLANE_KEYS[i - 1], b = PLANE_KEYS[i];
  const k = (t - a.t) / (b.t - a.t), ease = k * k * (3 - 2 * k);
  return { hand: a.hand.clone().lerp(b.hand, ease), twist: a.twist + (b.twist - a.twist) * ease };
}

/** Darts (#54): the throwing hand while aiming, drawn back just before the release, and at the release; beside the head, never in it (#87). */
const AIM_HAND = new THREE.Vector3(0.5, 1.55, 0.2);
const DRAWN_HAND = new THREE.Vector3(0.5, 1.6, -0.05);
const THROWN_HAND = new THREE.Vector3(RELEASE_HAND.x, RELEASE_HAND.y, RELEASE_HAND.z);
/** Collecting (#80): the hand at its side while walking, and reaching up to the board. */
const DART_LOW = new THREE.Vector3(0.3, 0.6, 0.06);
const DART_REACH = new THREE.Vector3(0.3, 1.55, 0.4);

/** The throwing hand `u` seconds into a throw: aim, draw back, snap forward to let go, follow through, back to aim. */
function dartHand(u: number) {
  const ease = (k: number) => k * k * (3 - 2 * k);
  const from = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, ease(Math.min(1, Math.max(0, k))));
  if (u < RELEASE_AT - 0.3) return AIM_HAND.clone();
  if (u < RELEASE_AT - 0.12) return from(AIM_HAND, DRAWN_HAND, (u - (RELEASE_AT - 0.3)) / 0.18);
  if (u < RELEASE_AT) return DRAWN_HAND.clone().lerp(THROWN_HAND, (u - (RELEASE_AT - 0.12)) / 0.12);
  if (u < RELEASE_AT + 0.4) return THROWN_HAND.clone();
  return from(THROWN_HAND, AIM_HAND, (u - RELEASE_AT - 0.4) / 0.4);
}

/** Fetch (#75): the ball hand waiting, drawn back, and at the release. */
const BALL_READY = new THREE.Vector3(0.35, 1.0, 0.25);
const BALL_DRAWN = new THREE.Vector3(0.35, 1.45, -0.15);
const BALL_THROWN = new THREE.Vector3(0.25, 1.45, 0.6);
const BALL_SNAP = 0.15;
/** Seconds after the release before the thrower turns back to watch the dog (#114). */
const BALL_FOLLOW_THROUGH = 0.4;

/** The ball hand `u` seconds into a throw (null: none): draw back, snap forward to let go, follow through, back to ready. */
function ballHand(u: number | null) {
  const ease = (k: number) => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };
  if (u == null) return BALL_READY.clone();
  const snapAt = BALL_RELEASE_AT - BALL_SNAP;
  if (u < snapAt) return BALL_READY.clone().lerp(BALL_DRAWN, ease(u / snapAt));
  if (u < BALL_RELEASE_AT) return BALL_DRAWN.clone().lerp(BALL_THROWN, (u - snapAt) / BALL_SNAP);
  return BALL_THROWN.clone().lerp(BALL_READY, ease((u - BALL_RELEASE_AT - 0.3) / 0.5));
}

/** Table tennis (#70): the bat's blade sits this far from the hand; a swing takes SWING seconds, centred on the hit. */
const BLADE = new THREE.Vector3(0, 0.2, 0.05);
const SWING = 0.3;
const WIND = 0.25;
/** How far the upper body turns, back before a hit and through after (#115). */
const TWIST = 0.3;
/** The hand when the blade is where the ball is hit, and when waiting between hits. */
const CONTACT = new THREE.Vector3(HIT.side, HIT.y, HIT.reach).sub(BLADE);
const READY = new THREE.Vector3(0.35, 0.8, 0.05);

/**
 * The bat hand during a rally: ready, then back, forward through the ball at each hit, and back to ready.
 * Whoever missed serves the next rally as this one ends, so they wind up for it in time (#80).
 */
function batHand({ rally, side, t }: { rally: Rally; side: Side; t: number }) {
  const back = CONTACT.clone().setZ(CONTACT.z - WIND), through = CONTACT.clone().setZ(CONTACT.z + WIND);
  const serves = -hitter(rally, rally.hits) === side ? [rallySeconds(rally)] : [];
  const d = [...hitTimes(rally, side), ...serves].map((h) => t - h).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a), Infinity);
  // The body turns with the bat: back (bat shoulder behind) as it winds up, through after the hit.
  if (Math.abs(d) <= SWING / 2) {
    const k = d / SWING + 0.5;
    return { hand: back.lerp(through, k), twist: TWIST * (1 - 2 * k) };
  }
  if (d < 0 && d > -SWING / 2 - 0.25) {
    const k = smooth((d + SWING / 2 + 0.25) / 0.25);
    return { hand: READY.clone().lerp(back, k), twist: TWIST * k };
  }
  if (d > 0 && d < SWING / 2 + 0.25) {
    const k = smooth((d - SWING / 2) / 0.25);
    return { hand: through.lerp(READY, k), twist: -TWIST * (1 - k) };
  }
  return { hand: READY.clone(), twist: 0 };
}

/** The free hand during a rally (#115): tossing the ball to serve, or a fist pump after winning the point. */
function freeHand({ rally, side, t }: { rally: Rally; side: Side; t: number }, tt: number) {
  const local = (p: typeof FREE_HAND) => new THREE.Vector3(p.x, p.y, p.z);
  if (rally.server === side && t < 0) return local(tossHand(t));
  const won = hitter(rally, rally.hits) === side ? reactionAt(rally, t) : 0;
  const pump = new THREE.Vector3(-0.45, 1.9 + Math.abs(Math.sin(tt * 9)) * 0.12 * motion, 0.15);
  return local(FREE_HAND).lerp(pump, won);
}

/** Trampoline (#60): on the mat for CONTACT seconds, squashing and springing back, then a FLIGHT up and down. */
const BOUNCE = { low: 0.12, height: 0.55, contact: 0.18, flight: 0.75 };

/**
 * The bounce `t` seconds in: body height (a parabola in time through each flight, like a thrown
 * ball), its squash on the mat (eased in and out), and how high it is as a fraction of the top.
 */
export function bounceAt(t: number) {
  const { low, height, contact, flight } = BOUNCE;
  const period = contact + flight, u = ((t % period) + period) % period;
  const top = height * motion;
  if (u < contact) return { y: low, squash: 1 - 0.1 * motion * Math.sin((Math.PI * u) / contact), k: 0, period, flight };
  const f = (u - contact) / flight, rise = 4 * f * (1 - f);
  return { y: low + top * rise, squash: 1, k: rise, period, flight };
}

/** Yoga (#79): facing along the mat, the yogi holds each pose for HOLD seconds, then eases into the next over EASE. */
const YOGA = { hold: 4, ease: 1.5 };
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const YOGA_POSES = [
  // Tree: one foot on the other knee, palms together overhead.
  { body: { y: 0, z: 0, tip: 0 }, twist: 0, look: -0.05, hands: [v(-0.07, 1.85, 0.05), v(0.07, 1.85, 0.05)], feet: [v(-0.05, 0.1, 0.04), v(0.12, 0.42, 0.12)] },
  // Warrior II: side on, feet wide along the mat, arms out along it, looking ahead.
  { body: { y: -0.08, z: 0, tip: 0 }, twist: Math.PI / 2, look: 0, hands: [v(0, 0.95, 0.85), v(0, 0.95, -0.85)], feet: [v(-0.05, 0.1, 0.55), v(0.05, 0.1, -0.55)] },
  // Downward dog: hips high, hands and feet planted far apart.
  { body: { y: 0.45, z: -0.35, tip: 1.25 }, twist: 0, look: 0.3, hands: [v(-0.25, 0.18, 0.75), v(0.25, 0.18, 0.75)], feet: [v(-0.2, 0.1, -0.7), v(0.2, 0.1, -0.7)] },
  // Forward fold: feet together, folded over, palms on the mat.
  { body: { y: 0.35, z: -0.1, tip: 1.5 }, twist: 0, look: 0.4, hands: [v(-0.2, 0.18, 0.45), v(0.2, 0.18, 0.45)], feet: [v(-0.15, 0.1, -0.1), v(0.15, 0.1, -0.1)] },
];

/** The yogi's body, twist, head and limbs `t` seconds onto the mat. */
function yogaAt(t: number) {
  const { hold, ease } = YOGA, each = hold + ease, n = YOGA_POSES.length;
  const i = Math.floor(t / each) % n, u = t % each;
  const a = YOGA_POSES[i], b = YOGA_POSES[(i + 1) % n];
  const k = u < hold ? 0 : (u - hold) / ease, s = k * k * (3 - 2 * k);
  const mix = (x: number, y: number) => x + (y - x) * s;
  return {
    body: { y: mix(a.body.y, b.body.y), z: mix(a.body.z, b.body.z), tip: mix(a.body.tip, b.body.tip) },
    twist: mix(a.twist, b.twist),
    look: mix(a.look, b.look),
    hands: a.hands.map((h, j) => h.clone().lerp(b.hands[j], s)),
    feet: a.feet.map((f, j) => f.clone().lerp(b.feet[j], s)),
  };
}

/** Break-room poses (#30); each sets the body and returns the bubble height. */
const ACTIVITY_POSES: Partial<Record<HangoutPose, (b: Body, tt: number) => number>> = {
  'lounging-sun': ({ pivot, head, hands: [hl, hr], feet: [fl, fr] }, tt) => {
    // Lying back along the backrest (#64): hips where it meets the seat, back and head on its slope, legs along the seat.
    const { d, seatTop, back } = BREAK_ROOM.lounger;
    const hingeZ = -d / 2 + back.length * Math.cos(back.angle);
    const rest = 0.38; // from the backrest's surface to the body's axis: its back, plus a little cushion
    pivot.rotation.x = -(Math.PI / 2 - back.angle);
    pivot.position.set(0, seatTop + rest * Math.cos(back.angle) - SEAT_Y, hingeZ + rest * Math.sin(back.angle));
    head.rotation.x = 0.35 + Math.sin(tt * 0.5) * 0.04 * motion;
    hl.position.set(-0.45, 0.62, 0.3);
    hr.position.set(0.45, 0.62, 0.3);
    fl.position.set(-0.15, 0.02, 0.8);
    fr.position.set(0.15, 0.02, 0.8);
    return 1.9;
  },
  swinging: ({ pivot, head, hands: [hl, hr], feet: [fl, fr] }, tt) => {
    const sway = Math.sin(tt * 1.3) * 0.15 * motion;
    pivot.rotation.set(-1.3, 0, sway);
    pivot.position.set(sway * 0.6, 0.25, 0.4);
    head.rotation.x = 0.6;
    hl.position.set(-0.35, 0.55, -0.6);
    hr.position.set(0.35, 0.55, -0.6);
    fl.position.set(-0.15 + sway * 0.6, 0.45, 0.85);
    fr.position.set(0.15 + sway * 0.6, 0.45, 0.85);
    return 1.6;
  },
  bouncing: ({ pivot, head, hands: [hl, hr], feet: [fl, fr] }, tt) => {
    const { y, squash, k } = bounceAt(tt);
    pivot.position.y = y;
    pivot.scale.y = squash;
    head.rotation.x = -0.2 * k;
    hl.position.set(-0.45, 0.9 + y + k * 0.4, 0.05);
    hr.position.set(0.45, 0.9 + y + k * 0.4, 0.05);
    fl.position.set(-0.17, 0.08 + y, 0.04);
    fr.position.set(0.17, 0.08 + y, 0.04);
    return 2.3 + y;
  },
  yoga: ({ pivot, head, hands: [hl, hr], feet: [fl, fr], placeTime = 0 }) => {
    // A flow (#79): each pose held, then eased into the next, looping.
    const { body, twist, look, hands, feet } = yogaAt(placeTime);
    pivot.position.set(0, body.y, body.z);
    pivot.rotation.set(body.tip, twist, 0);
    head.rotation.set(look, -twist, 0);
    hl.position.copy(hands[0]);
    hr.position.copy(hands[1]);
    fl.position.copy(feet[0]);
    fr.position.copy(feet[1]);
    return 2.4;
  },
  fishing: ({ head, hands: [hl, hr], held, casting }) => {
    // The rod points out over the water, tip up; a cast swings it back over the shoulder and forward (#58).
    const pitch = casting ? rodPitch(casting.cast, casting.t) : 0.5;
    head.rotation.x = 0.15;
    hl.position.set(-0.12, 0.75, 0.42);
    hr.position.set(ROD_HAND.x, ROD_HAND.y, ROD_HAND.z);
    if (held) held.rotation.x = Math.PI / 2 - pitch;
    return 2.2;
  },
  'throwing-darts': ({ head, hands: [hl, hr], feet: [fl, fr], held, placeTime = 0 }) => {
    const round = dartsAt(placeTime), r = ((placeTime % ROUND) + ROUND) % ROUND;
    head.rotation.x = -0.05;
    hl.position.set(-0.45, 0.65, 0.1);
    if (held) held.visible = round.holding;
    if (r < THROWS * THROW_EVERY) {
      hr.position.copy(dartHand(r % THROW_EVERY));
      // Back from collecting, the hand comes up from its side to aim (#80).
      if (placeTime >= ROUND) hr.position.lerpVectors(DART_LOW, hr.position, smooth(Math.min(1, r / 0.6)));
      return 2.2;
    }
    // Collecting: walking up to the board and back, reaching up to pull the darts out; every move eased (#80).
    const c = r - THROWS * THROW_EVERY;
    const step = Math.sin(round.walk * Math.PI * 4);
    fl.position.set(-0.17, 0.06 + Math.max(0, step) * 0.1, 0.04 + step * 0.16);
    fr.position.set(0.17, 0.06 + Math.max(0, -step) * 0.1, 0.04 - step * 0.16);
    const eased = (k: number) => smooth(Math.min(1, Math.max(0, k)));
    const reach = Math.min(eased((c - DARTS_WALK + 0.4) / 0.4), 1 - eased((c - DARTS_WALK - DARTS_PULL + 0.4) / 0.4));
    hr.position.lerpVectors(AIM_HAND, DART_LOW, eased(c / 0.4)).lerp(DART_REACH, reach);
    return 2.2;
  },
  'shooting-hoops': ({ pivot, head, hands: [hl, hr], feet: [fl, fr], held, placeTime = 0 }) => {
    // Hands either side of the ball, up as the shooter jumps; it lets go at the top and the bin's ball takes over (#73).
    const { hands, jump, holding } = shotAt(placeTime);
    pivot.position.y = jump;
    head.rotation.x = -0.25;
    hl.position.set(-HANDS.apart, hands, HANDS.forward);
    hr.position.set(HANDS.apart, hands, HANDS.forward);
    fl.position.set(-0.17, 0.06 + jump, 0.04);
    fr.position.set(0.17, 0.06 + jump, 0.04);
    if (held) {
      held.visible = holding;
      held.position.set(-HANDS.apart, HANDS.under, 0);
    }
    return 2.2 + jump;
  },
  'throwing-plane': ({ pivot, head, hands: [hl, hr], held, planeThrow }) => {
    // Holding a plane until the controller says throw (#74): wind up, let go, follow through, pick up the next.
    const t = planeThrow?.t ?? Infinity, { hand, twist } = planeArm(t);
    pivot.rotation.y = twist;
    head.rotation.x = -0.15;
    hl.position.set(-0.4, 0.75, 0.25);
    hr.position.copy(hand);
    if (held) held.visible = t < PLANE_ARM.release || t >= PLANE_ARM.end;
    return 2.2;
  },
  'cue-shot': ({ pivot, head, hands: [hl, hr], held, shotTime }) => {
    // Leaning in at the end of the table, drawing the cue back and striking the ball as it starts moving (#76).
    pivot.rotation.x = 0.05;
    head.rotation.x = 0.1;
    // The cue slides back and forth along its own line through the bridge, so it never swings in under the chin (#117).
    hl.position.copy(CUE_BRIDGE);
    hr.position.copy(CUE_STRIKE_HAND).addScaledVector(CUE_ALONG, -cueBack(shotTime ?? null) * motion);
    if (held) held.quaternion.setFromUnitVectors(UP, CUE_ALONG);
    return 2.0;
  },
  'cue-wait': ({ pivot, head, hands: [hl, hr], held }, tt) => {
    // Leaning on the cue, watching: it stands upright on its butt, off to the side, well clear of the head (#117).
    pivot.rotation.z = 0.06;
    head.rotation.y = Math.sin(tt * 0.6) * 0.2 * motion;
    hl.position.set(-0.42, 0.62, 0.1);
    hr.position.set(CUE_STAND.x, CUE_STAND.y, CUE_STAND.z);
    if (held) {
      held.position.set(0, -CUE_STAND.grip, 0);
      held.rotation.set(0, 0, -0.04);
    }
    return 2.2;
  },
  paddle: ({ pivot, head, hands: [hl, hr], feet: [fl, fr], rally }, tt) => {
    // Ready stance, knees bent, bouncing on the toes; the bat swings through the ball at each of this
    // player's hits, the body turning with it (#115). The free hand tosses to serve and pumps a won point.
    const bounce = Math.abs(Math.sin(tt * 4.5)) * 0.04 * motion;
    const { hand, twist } = rally ? batHand(rally) : { hand: READY.clone(), twist: 0 };
    pivot.position.y = -0.04 + bounce;
    pivot.rotation.set(0.15, twist, 0);
    head.rotation.set(-0.1, -twist, 0);
    hl.position.copy(rally ? freeHand(rally, tt) : FREE_HAND);
    hr.position.copy(hand);
    fl.position.set(-0.22, 0.06 + bounce * 0.5, 0.04);
    fr.position.set(0.22, 0.06 + bounce * 0.5, 0.04);
    return 2.2 + bounce;
  },
  floating: ({ pivot, head, hands: [hl, hr], feet: [fl, fr] }) => {
    // Sitting low in a rubber ring, arms over its sides; the water hides the legs. The ring bobs them both (#57).
    pivot.position.y = -0.72;
    pivot.rotation.x = -0.15;
    head.rotation.x = -0.2;
    hl.position.set(-0.36, -0.22, 0.1);
    hr.position.set(0.36, -0.22, 0.1);
    fl.position.set(-0.15, -0.6, 0.2);
    fr.position.set(0.15, -0.6, 0.2);
    return 1.5;
  },
  watching: ({ pivot, head, hands: [hl, hr] }, tt) => {
    // Peering over someone's shoulder, hands on hips; upright, so it stays clear of their chair (#67).
    // Eyes level with the monitor, under the seated agent's head (#78).
    pivot.rotation.x = 0.05;
    head.rotation.x = 0.12;
    head.rotation.z = Math.sin(tt * 0.8) * 0.1 * motion;
    hl.position.set(-0.42, 0.62, 0.1);
    hr.position.set(0.42, 0.62, 0.1);
    return 2.15;
  },
  'high-five': ({ head, hands: [hl, hr] }) => {
    head.rotation.x = -0.15;
    hl.position.set(-0.47, 0.6, 0.06);
    hr.position.set(0.3, 1.75, 0.25);
    return 2.3;
  },
  delivering: ({ pivot, head, hands: [hl, hr] }) => {
    // Just set a mug down on the desk.
    pivot.rotation.x = 0.18;
    head.rotation.x = 0.2;
    hl.position.set(-0.47, 0.6, 0.06);
    hr.position.set(0.25, 0.85, 0.5);
    return 2.2;
  },
  petting: ({ pivot, head, hands: [hl, hr], feet: [fl, fr] }, tt) => {
    // Crouched by the dog, a hand stroking its back.
    pivot.position.y = -0.22;
    pivot.rotation.x = 0.35;
    head.rotation.x = 0.35;
    hl.position.set(-0.4, 0.4, 0.15);
    hr.position.set(0.05, 0.45, 0.62 + Math.sin(tt * 3) * 0.08 * motion);
    fl.position.set(-0.2, 0.06, 0.2);
    fr.position.set(0.2, 0.06, 0.2);
    return 1.95;
  },
  feeding: ({ pivot, head, hands: [hl, hr], held }, tt) => {
    // Bent over the bowl, shaking food out of a box.
    pivot.rotation.x = 0.3;
    head.rotation.x = 0.4;
    hl.position.set(-0.4, 0.55, 0.15);
    hr.position.set(0.12, 0.85, 0.55);
    if (held) held.rotation.z = 1.6 + Math.sin(tt * 8) * 0.2 * motion;
    return 2.1;
  },
  'throwing-ball': ({ pivot, head, hands: [hl, hr], fetchThrow = null }) => {
    // The ball itself is the fetch ball's (#75); the body turns with the throwing arm.
    hr.position.copy(ballHand(fetchThrow));
    pivot.rotation.y = -0.2 + ((hr.position.z - BALL_DRAWN.z) / (BALL_THROWN.z - BALL_DRAWN.z)) * 0.35;
    head.rotation.x = -0.1;
    hl.position.set(-0.4, 0.75, 0.25);
    return 2.2;
  },
  gaming: ({ pivot, head, hands: [hl, hr], feet: [fl, fr] }, tt) => {
    // On the sofa, leaning in, thumbs going.
    const mash = Math.max(0, Math.sin(tt * 14)) * 0.025 * motion;
    pivot.position.y = SOFA_LIFT;
    // Rocking forward and back, not side to side, so neighbours on the sofa don't bump heads (#112).
    pivot.rotation.x = 0.12 + Math.sin(tt * 0.9) * 0.05 * motion;
    head.rotation.x = -0.05;
    hl.position.set(-0.12, 0.62 + mash, 0.4);
    hr.position.set(0.12, 0.62, 0.4);
    fl.position.set(-0.16, -0.24, 0.34);
    fr.position.set(0.16, -0.24, 0.34);
    return 2.1;
  },
};

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Pool (#76): how far the cue hand is behind the strike, `t` seconds into the turn: at rest, then drawn back slowly, pushed through to the ball at STRIKE_AT, and eased back. */
function cueBack(t: number | null) {
  const s = t == null ? Infinity : t - STRIKE_AT;
  if (s < -0.5 || s >= 0.6) return CUE_REST;
  if (s < -0.25) return CUE_REST + (CUE_DRAWN - CUE_REST) * smooth((s + 0.5) / 0.25);
  if (s < 0) return CUE_DRAWN * (1 - ((s + 0.25) / 0.25) ** 2);
  return CUE_REST * smooth(s / 0.6);
}

/** A jack-o'-lantern treat bucket with a handle, a few lollies poking out. */
function treatBucket() {
  const g = new THREE.Group();
  g.add(at(cyl(0.13, 0.11, 0.18, '#F07A1A', { outline: 0.06 }), 0, -0.14, 0.04));
  for (const x of [-0.04, 0.04]) g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: '#2A2233' })), x, -0.11, 0.17));
  const handle = mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 16, Math.PI), '#2A2233', { outline: 0 });
  handle.position.set(0, -0.06, 0.04);
  g.add(handle);
  ['#E0475A', '#9B5CFF', '#5BC0EB'].forEach((color, i) => g.add(at(ball(0.035, color, { outline: 0.1 }), -0.05 + i * 0.05, -0.04, 0.04)));
  return g;
}

function heldProps(): Partial<Record<HangoutPose, THREE.Object3D>> {
  const rod = new THREE.Group();
  const pole = at(cyl(0.015, 0.025, ROD_LENGTH, '#8C6A4A', { outline: 0 }), 0, ROD_LENGTH / 2, 0);
  pole.userData.part = 'rod';
  rod.add(pole);
  const dart = dartModel();
  const ball = hoopsBall();
  // Gripped near the butt: the tip is 1.07 m along from the hand.
  const cue = () => tag(at(cyl(0.012, 0.022, 1.45, '#E9B872', { outline: 0.03 }), 0, 0.345, 0), 'cue');
  const bat = new THREE.Group();
  bat.add(Object.assign(at(cyl(0.14, 0.14, 0.03, '#C25B7A', { outline: 0.05 }), BLADE.x, BLADE.y, BLADE.z), { userData: { part: 'bat-blade' } }));
  bat.add(at(cyl(0.025, 0.025, 0.12, WOOD_DARK, { outline: 0 }), 0, 0.05, 0.02));
  bat.children[0].rotation.x = Math.PI / 2;
  const holding = (o: THREE.Object3D) => new THREE.Group().add(o);
  return {
    fishing: rod, 'throwing-darts': dart, 'shooting-hoops': ball, 'throwing-plane': paperPlane(),
    'cue-shot': holding(cue()), 'cue-wait': holding(cue()), paddle: bat, gaming: gamepad(),
    feeding: at(mesh(new THREE.BoxGeometry(0.14, 0.2, 0.08), '#F07A4A', { outline: 0.06 }), 0, 0.1, 0.05),
  };
}

/** A TV remote (#113), held pointing forward out of the left hand. */
function remoteModel() {
  const remote = new THREE.Group();
  remote.userData.kind = 'remote';
  remote.add(at(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.18), INK_DARK, { outline: 0.06 }), 0, 0.03, 0.1));
  remote.add(at(ball(0.015, '#FF5A5A', { outline: 0, shadow: false }), 0, 0.05, 0.16));
  remote.visible = false;
  return remote;
}

/** A game controller, held in both hands (it hangs off the right one). */
function gamepad() {
  const pad = new THREE.Group();
  pad.userData.kind = 'controller';
  pad.add(at(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.12), INK_DARK, { outline: 0.06 }), -0.12, 0.06, 0.02));
  pad.add(at(ball(0.025, '#FF5A5A', { outline: 0, shadow: false }), -0.04, 0.1, 0.02));
  pad.add(at(ball(0.025, '#4D86FF', { outline: 0, shadow: false }), -0.2, 0.1, 0.02));
  return pad;
}

/** A dart (#54): point, barrel, shaft and crossed flights, pointing along +z from its origin (the grip). */
export function dartModel() {
  const dart = new THREE.Group();
  const along = (o: THREE.Mesh, z: number, part?: string) => {
    o.rotation.x = Math.PI / 2;
    o.position.z = z;
    if (part) o.userData.part = part;
    return dart.add(o);
  };
  along(cyl(0.002, 0.01, 0.05, '#C9C0E3', { outline: 0, shadow: false }), DART.tip - 0.025, 'dart-point');
  along(cyl(0.022, 0.022, 0.19, '#FF5A5A', { outline: 0.05, shadow: false }), 0.065, 'dart-barrel');
  along(cyl(0.008, 0.008, 0.12, INK_DARK, { outline: 0, shadow: false }), -0.09);
  const flights = new THREE.Group();
  flights.userData.part = 'dart-flights';
  for (const turn of [0, Math.PI / 2]) {
    const fin = mesh(new THREE.BoxGeometry(0.1, 0.004, 0.08), '#4D86FF', { outline: 0, shadow: false });
    fin.rotation.z = turn;
    flights.add(fin);
  }
  flights.position.z = 0.04 - DART.tail;
  dart.add(flights);
  return dart;
}

/** A basketball (#73). */
export function hoopsBall() {
  const ball = mesh(new THREE.SphereGeometry(0.13, 16, 12), '#F07A4A', { outline: 0.06 });
  ball.userData.part = 'hoops-ball';
  return ball;
}

/** A small white dart-shaped plane, nose along +z. */
export function paperPlane() {
  const plane = mesh(new THREE.ConeGeometry(0.1, 0.3, 3), '#FFFFFF', { outline: 0.06 });
  plane.rotation.x = Math.PI / 2;
  plane.scale.set(1, 1, 0.25);
  plane.position.set(0, 0.12, 0.08);
  plane.userData.part = 'paper-plane';
  return plane;
}
