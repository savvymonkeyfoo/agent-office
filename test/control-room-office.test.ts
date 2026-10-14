import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildOffice, updateScreens } from '../src/client/office.ts';
import { arrivalPath, departurePath, fetchRun, route, type Point } from '../src/client/layout.ts';
import { heightAt, type ControlRoomLayout } from '../src/client/control-room.ts';
import { DOOR_REACH, STATUS_COLORS, STATUS_OFF, doorsOpen } from '../src/client/control-room-3d.ts';
import { allOnScreen, floorCorners, frameFloor, goHome, initialOrbit } from '../src/client/camera.ts';
import type { OfficeState } from '../src/shared/agent.ts';
import { obstaclesIn, routeCollisions } from './geometry.ts';
import { find, rec } from './office-sim.ts';

const build = (tiers = 3) => {
  const office = buildOffice(tiers, 'control-room');
  return { ...office, layout: office.layout as ControlRoomLayout };
};
const worldOf = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
const parts = (root: THREE.Object3D, name: string) => {
  const found: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.userData.part === name) found.push(o); });
  return found;
};

describe('#101 AC1 screen wall, tiered consoles with status lights, crew lounge, entrance, side door and deck', () => {
  const { group, layout, seats } = build();

  it('#101 AC1 three screens across the back, centred at one height, raised well clear of the floor; the side ones angled in', () => {
    const screens = find(group, 'wall-screen').sort((a, b) => worldOf(a).x - worldOf(b).x);
    expect(screens).toHaveLength(3);
    const [left, centre, right] = screens;
    const heights = screens.map((s) => worldOf(s).y);
    for (const y of heights) expect(y).toBeCloseTo(heights[0], 6);
    for (const s of screens) expect(boxOf(s).min.y, 'bottom edge').toBeGreaterThan(1.5);
    const width = (o: THREE.Object3D) => boxOf(o).max.x - boxOf(o).min.x;
    expect(width(centre)).toBeGreaterThan(width(left));
    expect(width(centre)).toBeGreaterThan(width(right));
    expect(worldOf(centre).x).toBeCloseTo(0, 6);
    // Each side screen faces in towards the middle of the room.
    const facing = (o: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
    expect(facing(left).x).toBeGreaterThan(0.1);
    expect(facing(right).x).toBeLessThan(-0.1);
    expect(facing(centre).z).toBeGreaterThan(0.99);
    for (const s of screens) expect(boxOf(s).min.z).toBeGreaterThanOrEqual(layout.room.back - 0.05);
  });

  it('#101 AC1 the side screens\' wall arms stay behind their faces and reach the wall', () => {
    for (const screen of find(group, 'wall-screen').filter((s) => Math.abs(worldOf(s).x) > 1)) {
      const [display] = parts(screen, 'display');
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(display.getWorldQuaternion(new THREE.Quaternion()));
      const face = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldOf(display));
      const arms = parts(screen, 'arm');
      expect(arms).toHaveLength(2);
      for (const arm of arms) {
        const corners = (arm as THREE.Mesh).geometry.attributes.position;
        for (let i = 0; i < corners.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(corners, i).applyMatrix4(arm.matrixWorld);
          expect(face.distanceToPoint(p), 'arm corner in front of the screen').toBeLessThan(-0.01);
        }
        expect(boxOf(arm).min.z, 'reaches the wall').toBeLessThan(layout.room.back + 0.01);
      }
    }
  });

  it('#101 AC1 a console per seat on its tier, each tier higher than the one in front', () => {
    const consoles = find(group, 'console');
    expect(consoles).toHaveLength(18);
    for (const seat of seats) {
      const c = consoles.find((o) => Math.hypot(worldOf(o).x - seat.desk.x, worldOf(o).z - seat.desk.z) < 1e-6)!;
      expect(c, `seat ${seat.index}`).toBeDefined();
      expect(worldOf(c).y).toBeCloseTo(layout.tiers[seat.row].height, 6);
    }
    expect(find(build(4).group, 'console')).toHaveLength(24);
  });

  it('#101 AC1 each console has a status light in its agent\'s state colour, and is dark when empty', () => {
    expect(find(group, 'status-light')).toHaveLength(18);
    const want: [OfficeState, string][] = [['working', '#5BD68A'], ['needs', '#FFB648'], ['done', '#4D86FF'], ['stale', '#8C8FA0']];
    for (const [state, color] of want) expect(STATUS_COLORS[state].toUpperCase()).toBe(color);
    const occupants = new Map(want.map(([state], i) => [i, rec(i + 1, state)]));
    updateScreens(seats, occupants, 0);
    want.forEach(([, color], i) => expect(`#${seats[i].light!.color.getHexString().toUpperCase()}`, want[i][0]).toBe(color));
    for (const seat of seats.slice(want.length)) expect(`#${seat.light!.color.getHexString().toUpperCase()}`).toBe(STATUS_OFF.toUpperCase());
    // A state change shows on the next update; leaving turns it off.
    updateScreens(seats, new Map([[0, rec(1, 'needs')]]), 1);
    expect(`#${seats[0].light!.color.getHexString().toUpperCase()}`).toBe('#FFB648');
    expect(`#${seats[1].light!.color.getHexString().toUpperCase()}`).toBe(STATUS_OFF.toUpperCase());
  });

  it('#101 AC1 a raised crew lounge with a glass rail along its front and steps down', () => {
    const [slab] = parts(group, 'crew-lounge');
    expect(boxOf(slab).max.y).toBeCloseTo(layout.crewLounge.height, 2);
    expect(boxOf(slab).min.z).toBeCloseTo(layout.crewLounge.z0, 2);
    const rails = find(group, 'glass-rail');
    expect(rails.length).toBe(layout.rail.length);
    for (const r of rails) {
      expect(boxOf(r).min.y).toBeGreaterThanOrEqual(layout.crewLounge.height - 0.01);
      expect(Math.abs((boxOf(r).min.z + boxOf(r).max.z) / 2 - layout.crewLounge.z0)).toBeLessThan(0.1);
    }
    // A staircase up each end of the tiers, each step lower than the lounge.
    const steps = parts(group, 'steps');
    for (const area of layout.steps) {
      const inside = steps.filter((s) => { const c = boxOf(s).getCenter(new THREE.Vector3()); return c.x > area.x0 && c.x < area.x1 && c.z > area.z0 && c.z < area.z1; });
      expect(inside.length, area.name).toBeGreaterThanOrEqual(2);
      for (const s of inside) expect(boxOf(s).max.y).toBeLessThan(layout.crewLounge.height);
    }
  });

  it('#101 AC1 the lounge props stand on the lounge floor', () => {
    for (const kind of ['sofa', 'tv', 'pool-table', 'ping-pong-table', 'kitchen-counter', 'water-cooler', 'bin']) {
      const [o] = find(group, kind);
      expect(o, kind).toBeDefined();
      expect(boxOf(o).min.y, kind).toBeGreaterThan(layout.crewLounge.height - 0.05);
    }
  });

  it('#101 AC1 an entrance in the left wall and a side door in the right wall, each in a gap in its wall', () => {
    const doors = find(group, 'door');
    const entrance = doors.find((d) => d.userData.part === 'entrance')!;
    const side = doors.find((d) => d.userData.part === 'side-door')!;
    expect(entrance).toBeDefined();
    expect(side).toBeDefined();
    expect(Math.abs(worldOf(entrance).x - layout.room.left)).toBeLessThan(0.4);
    expect(worldOf(entrance).z).toBeCloseTo(layout.door.z, 6);
    expect(worldOf(side).x).toBeCloseTo(layout.sideDoor.x, 1);
    expect(worldOf(side).z).toBeCloseTo(layout.sideDoor.z, 6);
    expect(parts(entrance, 'sign')).toHaveLength(1);
    const walls = find(group, 'wall').map(boxOf);
    for (const d of [layout.door, layout.sideDoor]) {
      for (const dz of [-0.4, 0, 0.4]) {
        const p = new THREE.Vector3(d.x > 0 ? layout.room.right + 0.1 : layout.room.left - 0.1, 1, d.z + dz);
        expect(walls.some((w) => w.containsPoint(p)), `wall across the door at z ${p.z}`).toBe(false);
      }
    }
  });

  it('#101 AC1 the deck holds the pool, the lake and its jetty; the lake winds round the fish and ends square at the deck\'s edge', () => {
    const [deck] = find(group, 'deck');
    for (const kind of ['pool', 'lake', 'jetty']) {
      const [o] = find(deck, kind);
      expect(o, kind).toBeDefined();
      const c = boxOf(o).getCenter(new THREE.Vector3());
      expect(c.x > layout.deck.x0 && c.x < layout.deck.x1 && c.z > layout.deck.z0 && c.z < layout.deck.z1, kind).toBe(true);
    }
    const [lake] = find(deck, 'lake');
    // It runs off the deck's front-right corner, cut square on the right and the front edge.
    const box = boxOf(lake);
    expect(box.max.x).toBeCloseTo(layout.deck.x1, 1);
    expect(box.max.z).toBeCloseTo(layout.deck.z1, 1);
    const cuts = parts(lake, 'cut-face').map(boxOf);
    expect(cuts).toHaveLength(2);
    const front = cuts.find((c) => c.min.z > layout.deck.z1 - 0.05)!;
    const right = cuts.find((c) => c.min.x > layout.deck.x1 - 0.05)!;
    expect(front, 'front cut face').toBeDefined();
    expect(right, 'right cut face').toBeDefined();
    expect(front.max.x).toBeCloseTo(layout.deck.x1, 1);
    expect(right.max.z).toBeCloseTo(layout.deck.z1, 1);
    for (const cut of cuts) expect(cut.min.y).toBeLessThan(-0.2);
    // The front cut face is the one the default camera sees: it faces the camera and is on screen.
    const camera = new THREE.PerspectiveCamera(34, 1.6, 0.1, 150);
    frameFloor(camera, initialOrbit(), layout.rows, 'control-room');
    expect(camera.position.z).toBeGreaterThan(layout.deck.z1);
    expect(allOnScreen(camera, [front.getCenter(new THREE.Vector3())])).toBe(true);
    // The shore: every point of the fish's pond is inside it.
    const shore = lake.userData.shore as Point[];
    const insideShore = (p: Point) => {
      let inside = false;
      for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
        const [a, b] = [shore[i], shore[j]];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      return inside;
    };
    const { pond } = layout.props;
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      expect(insideShore({ x: pond.x + pond.rx * Math.cos(a), z: pond.z + pond.rz * Math.sin(a) }), `pond edge at ${a.toFixed(1)}`).toBe(true);
    }
  });
});

describe('#101 AC2 the entrance doors are shut unless an agent is arriving or leaving', () => {
  const { layout, doors, group } = build();

  it('#101 AC2 the doors start shut, swing open (outwards) and shut again', () => {
    expect(doors).not.toBeNull();
    expect(doors!.openness).toBe(0);
    doors!.update(true, 1);
    expect(doors!.openness).toBe(1);
    group.updateMatrixWorld(true);
    for (const leaf of doors!.leaves) {
      const box = boxOf(leaf);
      expect(box.min.x, 'swings out of the room').toBeLessThan(layout.room.left - 0.3);
    }
    doors!.update(false, 1);
    expect(doors!.openness).toBe(0);
  });

  it('#101 AC2 open for an agent walking in or out through the door', () => {
    for (const seat of [layout.seats[0], layout.seats.at(-1)!]) {
      expect(doorsOpen(layout.door, [arrivalPath(layout, seat)[0]])).toBe(true);
      expect(doorsOpen(layout.door, [departurePath(layout, seat).at(-1)!])).toBe(true);
    }
    expect(doorsOpen(layout.door, [])).toBe(false);
  });

  it('#101 AC2 shut for everyone else: no seat, place or walk between them comes near the door', { timeout: 60_000 }, () => {
    const ends = [
      ...layout.seats.map((s) => s.link),
      ...layout.hangouts.flatMap((s) => s.places).map((p) => p.link),
      ...layout.dogSpots.flatMap((d) => [d.link, ...d.visitors.map((v) => v.link)]),
    ];
    for (const from of ends) {
      for (const to of ends) {
        if (from === to) continue;
        const path = route(layout, from, to);
        let closest = Infinity;
        for (let i = 0; i + 1 < path.length; i++) {
          for (let s = 0; s <= 10; s++) {
            const p = { x: path[i].x + ((path[i + 1].x - path[i].x) * s) / 10, z: path[i].z + ((path[i + 1].z - path[i].z) * s) / 10 };
            closest = Math.min(closest, Math.hypot(p.x - layout.door.x, p.z - layout.door.z));
          }
        }
        if (closest <= DOOR_REACH) expect.fail(`a walk from (${from[0].x}, ${from[0].z}) to (${to[0].x}, ${to[0].z}) passes the door`);
      }
    }
    for (const spot of layout.dogSpots) for (const p of fetchRun(layout, spot)) expect(Math.hypot(p.x - layout.door.x, p.z - layout.door.z)).toBeGreaterThan(DOOR_REACH);
  });
});

describe('#101 AC3 no furniture blocks any route', () => {
  for (const tiers of [3, 4]) {
    it(`#101 AC3 arrivals, departures, and walks between seats, places and dog spots miss every piece (${tiers} tiers)`, { timeout: 60_000 }, () => {
      const { group, layout } = build(tiers);
      const obstacles = obstaclesIn(group, (p) => heightAt(layout, p));
      expect(obstacles.length).toBeGreaterThan(50);
      for (const seat of layout.seats) {
        expect(routeCollisions(arrivalPath(layout, seat), obstacles), `arrive seat ${seat.index}`).toEqual([]);
        expect(routeCollisions(departurePath(layout, seat), obstacles), `depart seat ${seat.index}`).toEqual([]);
      }
      const places = [
        ...layout.hangouts.flatMap((s) => s.places).map((p) => ({ name: `${p.spot}@${p.x.toFixed(2)},${p.z.toFixed(2)}`, link: p.link })),
        ...layout.dogSpots.flatMap((d) => d.visitors.map((v, i) => ({ name: `dog ${d.name} visitor ${i}`, link: v.link }))),
        ...layout.poolTurns.flatMap((t, i) => [{ name: `pool shot ${i}`, link: t.shoot.link }, { name: `pool wait ${i}`, link: t.wait.link }]),
      ];
      const ends = [...places, { name: 'door', link: layout.doorLink }, { name: 'seat 0', link: layout.seats[0].link }, { name: 'last seat', link: layout.seats.at(-1)!.link }];
      for (const from of places) {
        for (const to of ends) {
          if (from === to) continue;
          expect(routeCollisions(route(layout, from.link, to.link), obstacles), `${from.name} → ${to.name}`).toEqual([]);
        }
      }
      // From every seat, along its tier to the staircases, out to every place and to the other seats.
      for (const seat of layout.seats) {
        for (const to of [...places, ...layout.seats.filter((s) => s !== seat).map((s) => ({ name: `seat ${s.index}`, link: s.link }))]) {
          expect(routeCollisions(route(layout, seat.link, to.link), obstacles), `seat ${seat.index} → ${to.name}`).toEqual([]);
        }
      }
      for (const spot of layout.dogSpots) expect(routeCollisions(fetchRun(layout, spot), obstacles), `dog ${spot.name}`).toEqual([]);
      // Pool players step straight between turns: the shooter back to wait, the other up to the next shot.
      const turns = layout.poolTurns, line = (a: Point, b: Point) => [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
      turns.forEach((turn, k) => {
        const next = turns[(k + 1) % turns.length], before = turns[(k + turns.length - 1) % turns.length];
        expect(routeCollisions(line(turn.shoot, turn.wait), obstacles), `pool ${k} back to wait`).toEqual([]);
        expect(routeCollisions(line(before.wait, next.shoot), obstacles), `pool up to shot ${(k + 1) % turns.length}`).toEqual([]);
      });
    });
  }

  it('#101 AC3 each console as built fits the footprint the plan routes round, and fills most of it', () => {
    for (const tiers of [3, 4]) {
      const { group, layout } = build(tiers);
      const consoles = find(group, 'console');
      expect(consoles).toHaveLength(layout.consoles.length);
      for (const plan of layout.consoles) {
        const built = consoles.find((o) => Math.hypot(worldOf(o).x - plan.x, worldOf(o).z - plan.z) < 1e-6)!;
        expect(built.rotation.y).toBeCloseTo(plan.yaw, 9);
        // Its solid parts (not the status light's glow) in its own frame: x across the console, z front to back.
        const local = new THREE.Box3();
        const toLocal = new THREE.Matrix4().copy(built.matrixWorld).invert();
        built.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.geometry.computeBoundingBox();
          local.union(o.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld)));
        });
        expect(Math.max(-local.min.x, local.max.x), 'half its width').toBeLessThanOrEqual(plan.w / 2 + 0.02);
        expect(Math.max(-local.min.z, local.max.z), 'half its depth').toBeLessThanOrEqual(plan.d / 2 + 0.02);
        expect(local.max.x - local.min.x).toBeGreaterThan(plan.w * 0.9);
        expect(local.max.z - local.min.z).toBeGreaterThan(plan.d * 0.9);
      }
    }
  });

  it('#101 AC3 the checker catches a walk through a console and through the rail', () => {
    const { group, layout } = build();
    const obstacles = obstaclesIn(group, (p) => heightAt(layout, p));
    const seat = layout.seats[0];
    expect(routeCollisions([{ x: seat.desk.x, z: seat.desk.z + 1.5 }, { x: seat.desk.x, z: seat.desk.z - 1.5 }], obstacles)).not.toEqual([]);
    expect(routeCollisions([{ x: -5, z: layout.crewLounge.z0 - 1 }, { x: -5, z: layout.crewLounge.z0 + 1 }], obstacles)).not.toEqual([]);
  });
});

describe('#101 AC4 the camera frames the whole office on load and after a tier is added', () => {
  const SHAPES = [[1440, 900], [2560, 1080], [390, 844], [844, 390], [768, 1024]] as const;
  for (const tiers of [3, 4]) {
    for (const [w, h] of SHAPES) {
      it(`#101 AC4 floor, deck, lounge and screen wall all on a ${w}×${h} screen (${tiers} tiers)`, () => {
        const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 150);
        const orbit = initialOrbit();
        frameFloor(camera, orbit, tiers, 'control-room');
        const layout = build(tiers).layout;
        expect(orbit.bounds).toEqual(layout.bounds);
        const corners = floorCorners(tiers, 'control-room');
        // The screen wall's top and the lounge's back edge are part of the office.
        expect(corners.some((p) => p.y >= layout.screenWall.height && p.z <= layout.room.back)).toBe(true);
        expect(corners.some((p) => p.y >= layout.crewLounge.height && p.z >= layout.crewLounge.z1)).toBe(true);
        expect(allOnScreen(camera, corners)).toBe(true);
        expect(orbit.radius).toBeLessThan(camera.far);

        // Home (and so a re-frame after a tier is added) keeps the whole office in view too.
        orbit.theta = 1; orbit.radius = 8;
        goHome(camera, orbit, tiers, 'control-room');
        expect(allOnScreen(camera, floorCorners(tiers, 'control-room'))).toBe(true);
      });
    }
  }

  it('#101 AC4 classic framing is unchanged', () => {
    const [a, b] = [new THREE.PerspectiveCamera(34, 1.6, 0.1, 150), new THREE.PerspectiveCamera(34, 1.6, 0.1, 150)];
    const [oa, ob] = [initialOrbit(), initialOrbit()];
    frameFloor(a, oa, 2);
    frameFloor(b, ob, 2, 'classic');
    expect(oa.radius).toBe(ob.radius);
    expect(floorCorners(2)).toEqual(floorCorners(2, 'classic'));
  });
});
