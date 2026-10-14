import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { arrivalPath, floorAt, officeLayout, planeLanding, route, type HangoutPlace, type Point } from '../src/client/layout.ts';
import type { ControlRoomLayout } from '../src/client/control-room.ts';
import { buildOffice } from '../src/client/office.ts';
import { Character } from '../src/client/character.ts';
import { Dog } from '../src/client/dog.ts';
import { FetchBall } from '../src/client/fetch.ts';
import { PaperPlanes } from '../src/client/paper-planes.ts';
import { BinBall, BoardDarts, DeskMugs, PongBallMesh, PoolBalls } from '../src/client/break-room.ts';
import { landingFrom } from '../src/client/fishing.ts';
import { find } from './office-sim.ts';

const layout = officeLayout(3, 'control-room') as ControlRoomLayout;
const { group } = buildOffice(3, 'control-room');
const floor = (p: Point) => floorAt(layout, p);
const look = { shirt: '#5B7DB1', hat: 'cap' as const, hatColor: '#3A3150', skin: '#F6CFA8' };
const spot = (name: string) => layout.hangouts.find((s) => s.name === name)!;
const LOUNGE = ['kitchen', 'water-cooler', 'lounge', 'couch-co-op', 'darts', 'hoops', 'pool-table', 'ping-pong'];
const DECK = ['pool-dip', 'loungers', 'fishing', 'hammock', 'trampoline', 'yoga'];
const inLounge = (p: Point) => p.z >= layout.crewLounge.z0 && p.z <= layout.crewLounge.z1 && p.x >= layout.room.left && p.x <= layout.room.right;
const onDeck = (p: Point) => p.x > layout.room.right && p.x <= layout.deck.x1 && p.z >= layout.deck.z0 && p.z <= layout.deck.z1;
const SEAT_Y = 0.38;

/** A character at `place`, settled for a moment. */
function hangingAt(place: HangoutPlace) {
  const c = new Character(look);
  c.ground = floor;
  c.placeAt(layout.seats[0], 'done', place);
  for (let i = 0; i < 3; i++) c.update(i / 60, 1 / 60);
  return c;
}

describe('#103 AC1 each activity plays at its new spot', () => {
  it('#103 AC1 the floor is the lounge floor in the lounge, the tier under the seats, and ground level on the deck and in the pit', () => {
    expect(floor({ x: -5, z: layout.crewLounge.z0 + 2 })).toBeCloseTo(layout.crewLounge.height, 6);
    for (const seat of layout.seats) expect(floor(seat.sit), `seat ${seat.index}`).toBeCloseTo(layout.tiers[seat.row].height, 6);
    expect(floor({ x: 16, z: 3 })).toBe(0);
    expect(floor({ x: 0, z: -6.3 })).toBe(0);
    // Classic is unchanged: flat everywhere.
    const classic = officeLayout(2);
    for (const p of [classic.seats[0].sit, ...classic.hangouts.flatMap((s) => s.places)]) expect(floorAt(classic, p)).toBe(0);
  });

  it('#103 AC1 lounge activities (darts, hoops, pool table, ping pong, sofa games, kitchen and cooler) are in the crew lounge, on its floor', () => {
    for (const name of LOUNGE) {
      for (const place of spot(name).places) {
        expect(inLounge(place), `${name} at (${place.x}, ${place.z})`).toBe(true);
        const c = hangingAt(place);
        const y = c.root.position.y - (place.sits ? SEAT_Y : 0);
        expect(y, `${name} stands on the lounge floor`).toBeGreaterThanOrEqual(layout.crewLounge.height - 1e-6);
        expect(y, name).toBeLessThan(layout.crewLounge.height + 0.35);
      }
    }
  });

  it('#103 AC1 deck activities (swimming, loungers, fishing from the jetty, hammock, trampoline, yoga) are on the deck', () => {
    for (const name of DECK) {
      for (const place of spot(name).places) {
        expect(onDeck(place), `${name} at (${place.x}, ${place.z})`).toBe(true);
        expect(hangingAt(place).root.position.y, name).toBeLessThan(0.9);
      }
    }
    // The angler stands at the jetty's lake end, facing the lake.
    const [angler] = spot('fishing').places;
    const { jetty, pond } = layout.props;
    expect(Math.abs(angler.x - jetty.x)).toBeLessThan(jetty.w / 2);
    expect(Math.hypot(angler.x + Math.sin(angler.yaw) * 1.5 - pond.x, angler.z + Math.cos(angler.yaw) * 1.5 - pond.z)).toBeLessThan(Math.hypot(angler.x - pond.x, angler.z - pond.z));
  });

  it('#101 AC1 the angler casts from the jetty into the lake: every landing is in the fish\'s water, beyond the jetty\'s lake end', () => {
    const { jetty, pond } = layout.props;
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const lakeSide = Math.sign(pond.x - jetty.x);
    for (let i = 0; i < 50; i++) {
      const p = landingFrom(random, layout.props);
      expect(((p.x - pond.x) / pond.rx) ** 2 + ((p.z - pond.z) / pond.rz) ** 2).toBeLessThan(1);
      expect(lakeSide * (p.x - jetty.x)).toBeGreaterThan(jetty.w / 2);
    }
  });

  it('#103 AC1 seated agents sit on their tier, at the height of their chair', () => {
    const chairs = find(group, 'chair');
    for (const seat of layout.seats) {
      const c = new Character(look);
      c.ground = floor;
      c.sitAt(seat, 'working');
      c.update(0, 1 / 60);
      const chair = chairs.find((o) => Math.hypot(o.position.x - seat.chair.x, o.position.z - seat.chair.z) < 1e-6)!;
      expect(c.root.position.y, `seat ${seat.index}`).toBeCloseTo(chair.getWorldPosition(new THREE.Vector3()).y + SEAT_Y, 6);
    }
  });

  it('#103 AC1 walking from the door to the lounge, nobody sinks into the tiers or floats, and the steps are climbed a step at a time', () => {
    const kitchen = spot('kitchen').places[0];
    const topSeat = layout.seats.at(-1)!;
    for (const path of [route(layout, layout.doorLink, kitchen.link), arrivalPath(layout, topSeat), route(layout, topSeat.link, spot('darts').places[0].link)]) {
      const c = new Character(look);
      c.ground = floor;
      c.arrive(topSeat, 'working', path);
      expect(c.mode).toBe('walking');
      let last = floor(c.root.position), frames = 0;
      for (let i = 0; i < 60 * 40 && c.mode === 'walking'; i++, frames++) {
        c.update(i / 60, 1 / 60);
        if (c.mode !== 'walking') break;
        const under = floor(c.root.position);
        expect(c.root.position.y).toBeGreaterThanOrEqual(under - 1e-6);
        expect(c.root.position.y).toBeLessThan(under + 0.1);
        expect(Math.abs(under - last), `a jump at (${c.root.position.x.toFixed(2)}, ${c.root.position.z.toFixed(2)})`).toBeLessThan(0.25);
        last = under;
      }
      expect(frames).toBeGreaterThan(60 * 3);
      expect(last).toBeGreaterThan(layout.tiers[0].height - 1e-6);
    }
  });

  it('#103 AC1 the darts, the hoops ball, the pool balls and the ping-pong ball are up in the lounge with the players', () => {
    const scene = new THREE.Scene();
    const props = () => layout.props;
    const darts = new BoardDarts(scene, props, floor);
    const thrower = hangingAt(spot('darts').places[0]);
    for (let t = 0; t < 6; t += 0.25) {
      darts.update({ place: thrower.place!, t });
      for (const d of darts.darts.filter((d) => d.visible)) expect(d.position.y).toBeGreaterThan(layout.crewLounge.height + 0.8);
    }
    const bin = new BinBall(scene, props, floor);
    bin.update({ place: spot('hoops').places[0], t: 2.6 }); // landed in the bin
    expect(bin.mesh.visible).toBe(true);
    expect(bin.mesh.position.y).toBeGreaterThan(layout.crewLounge.height);
    const pool = new PoolBalls(scene, props, floor);
    for (const m of pool.meshes) expect(m.position.y).toBeGreaterThan(layout.crewLounge.height + 0.8);
    const pong = new PongBallMesh(scene, props, floor);
    pong.play({ server: -1, hits: 4 });
    pong.update(0.3);
    expect(pong.mesh.visible).toBe(true);
    expect(pong.mesh.position.y).toBeGreaterThan(layout.crewLounge.height + 0.7);
  });

  it('#103 AC1 dog fetch: the dog and its ball are on the floor wherever they are, the lounge included', () => {
    const dog = new Dog();
    dog.ground = floor;
    const lounge = layout.dogSpots.find((s) => s.name === 'lounge')!;
    dog.placeAt(lounge.dog, false);
    dog.update(0, 1 / 60);
    expect(dog.root.position.y).toBeCloseTo(layout.crewLounge.height, 6);
    const bed = layout.dogSpots[0];
    dog.placeAt(bed.dog, true);
    dog.update(0, 1 / 60);
    expect(dog.root.position.y).toBe(0);
    const ball = new FetchBall(new THREE.Scene(), floor);
    ball.throw(lounge.fetch);
    const thrower = hangingAt({ ...lounge.visitors[0].at, spot: 'dog', yaw: 0, pose: 'throwing-ball', link: lounge.visitors[0].link });
    for (let i = 0; i < 120; i++) ball.update(1 / 60, thrower, dog);
    expect(ball.mesh.position.y).toBeGreaterThan(layout.crewLounge.height);
  });

  it('#103 AC1 a delivered mug sits on its console, up on the tier', () => {
    const scene = new THREE.Scene();
    const seat = layout.seats.at(-1)!;
    new DeskMugs(scene, floor).set(seat, true);
    const [mug] = find(scene, 'mug');
    expect(mug.position.y).toBeCloseTo(layout.tiers[seat.row].height + 0.85, 6);
  });
});

describe('#103 AC2 paper planes are thrown from the lounge rail and land in the pit', () => {
  it('#103 AC2 throwers stand at the rail, on the lounge floor, facing the pit', () => {
    for (const place of spot('planes').places) {
      expect(inLounge(place)).toBe(true);
      expect(place.z - layout.crewLounge.z0).toBeLessThan(0.8);
      expect(Math.cos(place.yaw)).toBeLessThan(-0.9);
      expect(hangingAt(place).root.position.y).toBeCloseTo(layout.crewLounge.height, 6);
    }
  });

  it('#103 AC2 each plane lands on the pit floor, between the screens and the first tier', () => {
    const planes = new PaperPlanes(new THREE.Scene());
    const from = new THREE.Vector3(-3, layout.crewLounge.height + 1.5, layout.crewLounge.z0 + 0.4);
    for (const seat of layout.seats) {
      const { at, onFloor } = planeLanding(layout, seat);
      expect(onFloor).toBe(true);
      expect(floor(at), `aimed at seat ${seat.index}`).toBe(0);
      expect(at.z).toBeGreaterThan(layout.screenWall.z + 0.5);
      expect(Math.hypot(at.x - layout.screenWall.focus.x, at.z - layout.screenWall.focus.z)).toBeLessThan(layout.tiers[0].inner - 0.3);
      expect(Math.abs(at.x)).toBeLessThan(layout.room.right - 1);
      planes.throw(from, at, onFloor);
    }
    planes.update(2);
    for (const p of planes.planes()) expect(p.position.y).toBeLessThan(0.1);
    // On the way they clear the consoles (monitors and status beacons) on the tiers they fly over.
    for (const place of spot('planes').places) {
      const flight = new PaperPlanes(new THREE.Scene());
      for (const seat of layout.seats) flight.throw(new THREE.Vector3(place.x, layout.crewLounge.height + 1.5, place.z), planeLanding(layout, seat).at, true);
      for (let t = 0; t < 1.4; t += 0.02) {
        flight.update(0.02);
        for (const p of flight.planes()) {
          const under = floor(p.position);
          const overConsole = layout.consoles.some((c) => {
            const dx = p.position.x - c.x, dz = p.position.z - c.z;
            return Math.abs(dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)) < c.w / 2 + 0.1 && Math.abs(dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)) < c.d / 2 + 0.1;
          });
          if (overConsole) expect(p.position.y, `over the tier at (${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)})`).toBeGreaterThan(under + 1.45);
        }
      }
    }
    // Classic planes still land on the desk they were thrown at.
    const classic = officeLayout(2);
    expect(planeLanding(classic, classic.seats[3])).toEqual({ at: classic.seats[3].desk, onFloor: false });
  });
});
