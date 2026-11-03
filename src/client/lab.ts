// The Innovation lab preset's floor plan: a copy of the Control room (control-room.ts), reskinned.
// One flat, warm room. Desks stand in pods of three, each pod on its own rug and given to one
// project at a time; pods sit in rows facing the board on the back wall (-z). A walkway runs
// along the front of the board from the entrance (left wall) to the side door (right wall), an
// aisle down each side, and a lane behind each row of chairs. The break corner (kitchen, sofa,
// games) is behind the desks, and the deck outside the side door keeps its pool and lake.
// A new row of pods goes in behind the last and pushes the break corner back; the deck stays.
import {
  BREAK_ROOM, CHAT_GAP, DARTS_LINE, HOOPS_LINE, SOFA_SEATS, turnsAround, yawTowards,
  type Area, type DogSpot, type HangoutPlace, type HangoutPose, type HangoutSpot, type Point, type Props, type SeatSpot,
} from './layout.ts';
import { PLAYER_X } from './pong.ts';

export const LAB_INITIAL_ROWS = 2;
/** Desks in a pod, and pods across a row. */
export const PER_POD = 3;
export const PODS_PER_ROW = 3;
const SEATS_PER_ROW = PER_POD * PODS_PER_ROW;

const ROOM = { left: -11, right: 11, back: -8.6 };
/** Pod centres across a row, and desk offsets within a pod (centre to centre). */
const POD_X = [-6.2, 0, 6.2];
const DESK_OFFSETS = [-1.6, 0, 1.6];
const DESK = { w: 1.4, d: 0.75 };
/** The first row's desks stand this far from the back wall; later rows ROW_GAP behind. */
const FIRST_DESK_Z = -4.2;
const ROW_GAP = 3.8;
const CHAIR_BEHIND = 0.95;
const APPROACH = 0.6;
/** Each row's walkway, behind its chairs. */
const LANE_BEHIND = 1.9;
/** The side aisles, from the front walkway down to the break corner. */
const AISLE_X = 9.6;
/** The walkway along the front of the board, from the entrance to the side door. */
const FRONT_Z = -6.6;
/** A pod's rug reaches this far in front of its desks and behind them (over its lane, short of the next row's rug). */
const RUG = { front: 0.8, back: 2.5, side: 0.95 };
/** The break corner: this far behind the last lane, and this deep. */
const CORNER_GAP = 1.0;
const CORNER_DEPTH = 6.2;
/** The break corner's walkway, this far behind its front. */
const PROMENADE = 1.0;
/** The board on the back wall: its middle, width and height (metres). */
const WALL_HEIGHT = 4.8;
const DECK = { x0: ROOM.right + 0.3, x1: 22.5, z0: ROOM.back, z1: 8.5 };
/** Deck walkways: one from the side door along the house, two across the deck. */
const SPINE_X = 12.6;
const DECK_BACK_Z = -3.6;
const DECK_FRONT_Z = 2.6;
const DECK_END_X = 21.4;

export type LabLayout = ReturnType<typeof labLayout>;

const deskZ = (row: number) => FIRST_DESK_Z + row * ROW_GAP;
const laneZ = (row: number) => deskZ(row) + LANE_BEHIND;

/** The Innovation lab with `rows` rows of pods (at least LAB_INITIAL_ROWS). */
export function labLayout(rows: number) {
  const rowCount = Math.max(rows, LAB_INITIAL_ROWS);
  const loungeFront = laneZ(rowCount - 1) + CORNER_GAP;
  const corner = {
    name: 'break corner', x0: ROOM.left, x1: ROOM.right, z0: loungeFront, z1: loungeFront + CORNER_DEPTH, height: 0,
    /** Its side walls rise this far (the dart board hangs on the left one). */
    wallHeight: 2.4,
  };
  /** A point in the break corner, `u` behind its front. */
  const inLounge = (x: number, u: number): Point => ({ x, z: loungeFront + u });
  const promenadeZ = loungeFront + PROMENADE;
  const toPromenade = (p: Point): Point[] => [p, { x: p.x, z: promenadeZ }];

  const seats = seatsFor(rowCount);
  const lanes = Array.from({ length: rowCount }, (_, row) => lane(row));
  const pods = Array.from({ length: rowCount * PODS_PER_ROW }, (_, i) => {
    const row = Math.floor(i / PODS_PER_ROW), x = POD_X[i % PODS_PER_ROW], z = deskZ(row);
    const half = DESK_OFFSETS.at(-1)! + DESK.w / 2 + RUG.side;
    return { index: i, row, x, z, seats: seats.filter((s) => s.pod === i).map((s) => s.index), rug: { x0: x - half, x1: x + half, z0: z - RUG.front, z1: z + RUG.back } };
  });
  const props = propsFor(inLounge);
  const lounge = { tv: { ...inLounge(3.2, 5.98), w: 2.6 }, sofa: { ...inLounge(3.2, 3.5), w: 2.8 }, rug: inLounge(3.2, 4.4) };
  const poolTurns = turnsAround(props.poolTable, (z) => [{ x: -1.8, z }, { x: -1.8, z: promenadeZ }]);

  const door: Point = { x: ROOM.left + 0.4, z: FRONT_Z };
  const sideDoor: Point = { x: ROOM.right, z: FRONT_Z };
  const walkways: Point[][] = [
    [{ x: -10.2, z: FRONT_Z }, { x: SPINE_X, z: FRONT_Z }],
    [{ x: -AISLE_X, z: FRONT_Z }, { x: -AISLE_X, z: promenadeZ }],
    [{ x: AISLE_X, z: FRONT_Z }, { x: AISLE_X, z: promenadeZ }],
    [{ x: -10.2, z: promenadeZ }, { x: 10.2, z: promenadeZ }],
    [{ x: SPINE_X, z: -7.8 }, { x: SPINE_X, z: 7.6 }],
    [{ x: SPINE_X, z: DECK_BACK_Z }, { x: DECK_END_X, z: DECK_BACK_Z }],
    [{ x: SPINE_X, z: DECK_FRONT_Z }, { x: DECK_END_X, z: DECK_FRONT_Z }],
    ...lanes,
  ];
  const kitchen = { counter: { ...inLounge(-6.0, 5.725), w: 3.6, d: 0.65 }, coffee: inLounge(-7.2, 5.725), table: inLounge(-6.0, 3.9) };
  const cooler = inLounge(-3.2, 5.8);

  return {
    preset: 'lab' as const,
    rows: rowCount,
    bounds: { left: ROOM.left, right: DECK.x1, back: ROOM.back, front: Math.max(corner.z1, DECK.z1) },
    hallZ: promenadeZ,
    door,
    /** From the entrance out to the front walkway. */
    doorLink: [{ ...door }, { x: -10.2, z: FRONT_Z }] as Point[],
    seats,
    pods,
    hangouts: hangoutsFor({ props, lounge, kitchen, cooler, poolTurns, inLounge, toPromenade }),
    walkways,
    dogSpots: dogSpotsFor(inLounge, promenadeZ),
    poolTurns,
    lanes,
    kitchen,
    cooler,
    bookshelf: { ...inLounge(ROOM.left + 0.22, 4.6), length: 1.6 },
    lounge,
    /** The board on the back wall. */
    board: { x: 0, w: 9.6 },
    windows: [] as number[],
    plants: [
      { x: ROOM.left + 0.6, z: ROOM.back + 0.6 }, { x: ROOM.right - 0.6, z: ROOM.back + 0.6 }, inLounge(ROOM.left + 0.6, 5.8),
      { x: 11.9, z: 7.8 }, { x: 22.0, z: -8.0 },
    ] as Point[],
    wallArt: [] as number[],
    props,
    room: { ...ROOM, front: corner.z1 },
    backWall: { z: ROOM.back, height: WALL_HEIGHT },
    /** Desk footprints, `w` across and `d` deep, turned to `yaw` like their seats. */
    desks: seats.map((s) => ({ ...s.desk, yaw: s.yaw, ...DESK })),
    crewLounge: corner,
    deck: { name: 'deck', ...DECK } as Area,
    sideDoor,
  };
}

/** Where a paper plane aimed at `seat` lands: on the floor in front of its desk (its desk may be packed away). */
export const labPlaneLanding = (seat: SeatSpot): Point => ({ x: seat.desk.x, z: seat.desk.z - DESK.d / 2 - 0.5 });

function seatsFor(rows: number): (SeatSpot & { pod: number })[] {
  return Array.from({ length: rows * SEATS_PER_ROW }, (_, index) => {
    const row = Math.floor(index / SEATS_PER_ROW), inRow = index % SEATS_PER_ROW;
    const podInRow = Math.floor(inRow / PER_POD);
    const x = POD_X[podInRow] + DESK_OFFSETS[inRow % PER_POD], z = deskZ(row);
    const desk = { x, z }, chair = { x, z: z + CHAIR_BEHIND }, approach = { x, z: z + CHAIR_BEHIND + APPROACH };
    return {
      index, row, pod: row * PODS_PER_ROW + podInRow, desk, chair, yaw: yawTowards(chair, desk), sit: chair, approach, standSpot: approach,
      askYaw: yawTowards(desk, chair),
      link: [chair, approach, { x, z: laneZ(row) }],
    };
  });
}

/** A row's walkway behind its chairs, from the left aisle to the right one. */
function lane(row: number): Point[] {
  const z = laneZ(row);
  const behind = POD_X.flatMap((px) => DESK_OFFSETS.map((dx) => ({ x: px + dx, z })));
  return [{ x: -AISLE_X, z }, ...behind, { x: AISLE_X, z }];
}

/** Break-corner props move back with it; deck props stay. */
function propsFor(inLounge: (x: number, u: number) => Point): Props {
  const pool = { x: 17.0, z: 0.6, w: 5.4, d: 2.8 };
  return {
    loungers: [{ x: 15.0, z: 3.95 }, { x: 15.8, z: 3.95 }],
    lounger: BREAK_ROOM.lounger,
    /** The fish's water, in the lake at the deck's front-right corner; the jetty reaches out to it from the lake's left shore. */
    pond: { x: 20.0, z: 6.5, rx: 1.7, rz: 1.1 },
    jetty: { x: 17.8, z: 6.5, w: 1.6, d: 0.8 },
    hammock: { x: 16.8, z: -6.6, trees: [15.3, 18.3] },
    yogaMat: { x: 21.0, z: -6.4, w: 1.8, d: 0.6 },
    trampoline: { x: 13.9, z: 5.6, r: 0.85 },
    /** On the break corner's left wall. */
    dartboard: inLounge(ROOM.left, 2.4),
    bin: inLounge(8.4, 5.4),
    petBed: { x: 11.9, z: -1.0, rx: 0.45, rz: 0.32 },
    bowl: { x: 11.95, z: -0.35, r: 0.13 },
    poolTable: { ...inLounge(-0.6, 3.3), w: 1.2, d: 2.2 },
    pingPong: { ...inLounge(7.6, 3.0), w: 2.2, d: 1.2 },
    pool: { ...pool, rings: [-1.95, -0.65, 0.65, 1.95].map((dx) => ({ x: pool.x + dx, z: pool.z })) },
  };
}

interface HangoutParts {
  props: Props;
  lounge: { sofa: Point };
  kitchen: { table: Point };
  cooler: Point;
  poolTurns: ReturnType<typeof turnsAround>;
  inLounge: (x: number, u: number) => Point;
  toPromenade: (p: Point) => Point[];
}

/** The Control room's activity spots, by the same names: games and the kitchen in the break corner, the outdoor ones on the deck. */
function hangoutsFor({ props, lounge, kitchen, cooler, poolTurns, inLounge, toPromenade }: HangoutParts): HangoutSpot[] {
  const place = (spot: string, pose: HangoutPose, p: Point, yaw: number, link: Point[], sits?: boolean): HangoutPlace =>
    ({ x: p.x, z: p.z, spot, yaw, pose, link: [{ x: p.x, z: p.z }, ...link], ...(sits && { sits }) });
  const solo = (spot: string, pose: HangoutPose, p: Point, yaw: number, link: Point[], sits?: boolean): HangoutSpot =>
    ({ name: spot, chat: false, places: [place(spot, pose, p, yaw, link, sits)] });
  const standing = (spot: string, p: Point, pose: HangoutPose, yaw = 0): HangoutPlace => ({ ...p, spot, yaw, pose, link: toPromenade(p) });
  const toDeck = (z: number) => (p: Point): Point[] => [p, { x: p.x, z }];
  const chatSpot = (name: string, centre: Point, link: (p: Point) => Point[]): HangoutSpot => {
    const [a, c] = [-1, 1].map((side) => ({ x: centre.x + (side * CHAT_GAP) / 2, z: centre.z }));
    const at = (p: Point, other: Point): HangoutPlace => ({ ...p, spot: name, yaw: yawTowards(p, other), pose: 'chatting', link: link(p) });
    return { name, chat: true, places: [at(a, c), at(c, a)] };
  };
  // The sofa faces the TV at the corner's back (+z); sitters get up and walk round its right end.
  const { sofa } = lounge;
  const seatZ = sofa.z + 0.25, sofaFront = sofa.z + 0.95, sofaEnd = sofa.x + 1.8;
  const sofaSeat = (x: number, spot = 'lounge', pose: HangoutPose = 'lounging'): HangoutPlace => ({
    x, z: seatZ, spot, yaw: 0, pose, sits: true,
    link: [{ x, z: seatZ }, { x, z: sofaFront }, ...toPromenade({ x: sofaEnd, z: sofaFront })],
  });
  const cooler2 = inLounge(cooler.x + 0.8, 5.25);
  const { pingPong: pong, pool, loungers, jetty, hammock, yogaMat, trampoline, dartboard, bin } = props;
  const left = -Math.PI / 2, right = Math.PI / 2;
  const pongEnd = (x: number) => ({ ...place('ping-pong', 'paddle', { x, z: pong.z }, 0, [{ x, z: toPromenade(pong)[1].z }]), yaw: yawTowards({ x, z: pong.z }, pong) });

  return [
    {
      name: 'kitchen',
      chat: false,
      places: [
        standing('kitchen', inLounge(-7.2, 4.9), 'drinking'),
        standing('kitchen', inLounge(-4.8, 4.9), 'eating'),
        standing('kitchen', { x: kitchen.table.x, z: kitchen.table.z - 0.75 }, 'eating'),
      ],
    },
    {
      name: 'water-cooler',
      chat: false,
      places: [standing('water-cooler', inLounge(cooler.x, 5.05), 'drinking'), standing('water-cooler', cooler2, 'drinking', yawTowards(cooler2, cooler))],
    },
    { name: 'lounge', chat: false, places: SOFA_SEATS.map((dx) => sofaSeat(sofa.x + dx)) },
    chatSpot('chat-hall', inLounge(-3.6, 2.2), toPromenade),
    chatSpot('chat-deck', { x: 20.6, z: 3.6 }, toDeck(DECK_FRONT_Z)),
    chatSpot('chat-deck-right', { x: 20.6, z: -1.6 }, toDeck(DECK_BACK_Z)),
    {
      name: 'loungers',
      chat: false,
      places: loungers.map((p) => place('loungers', 'lounging-sun', p, 0, [{ x: p.x, z: DECK_FRONT_Z }], true)),
    },
    // At the jetty's lake end, stepping off at its shore end.
    solo('fishing', 'fishing', { x: jetty.x + 0.2, z: jetty.z }, right, [{ x: jetty.x - 1.2, z: jetty.z }, { x: jetty.x - 1.2, z: DECK_FRONT_Z }]),
    solo('hammock', 'swinging', hammock, right, [{ x: hammock.x, z: DECK_BACK_Z }], true),
    solo('yoga', 'yoga', yogaMat, right, [{ x: yogaMat.x, z: DECK_BACK_Z }]),
    solo('trampoline', 'bouncing', trampoline, 0, [{ x: trampoline.x, z: DECK_FRONT_Z }], true),
    solo('darts', 'throwing-darts', { x: dartboard.x + DARTS_LINE, z: dartboard.z }, left, toPromenade({ x: dartboard.x + DARTS_LINE, z: dartboard.z }).slice(1)),
    solo('hoops', 'shooting-hoops', { x: bin.x + HOOPS_LINE, z: bin.z }, left, toPromenade({ x: bin.x + HOOPS_LINE, z: bin.z }).slice(1)),
    // Thrown from the front of the break corner, towards the desks.
    { name: 'planes', chat: false, places: [-7.8, -3.0, 3.0, 7.8].map((x) => standing('planes', inLounge(x, 0.4), 'throwing-plane', Math.PI)) },
    { name: 'pool-table', chat: false, game: { min: 2 }, places: [poolTurns[0].shoot, poolTurns[1].wait] },
    { name: 'ping-pong', chat: false, game: { min: 2 }, places: [pongEnd(pong.x - PLAYER_X), pongEnd(pong.x + PLAYER_X)] },
    {
      name: 'pool-dip',
      chat: false,
      places: pool.rings.map((r) => {
        const edge = { x: r.x, z: pool.z - pool.d / 2 - 0.2 };
        return { ...r, spot: 'pool-dip', yaw: 0, pose: 'floating' as const, sits: true, link: [{ ...r }, edge, { x: edge.x, z: DECK_BACK_Z }] };
      }),
    },
    { name: 'couch-co-op', chat: false, game: { min: 2 }, places: SOFA_SEATS.map((dx) => sofaSeat(sofa.x + dx, 'couch-co-op', 'gaming')) },
  ];
}

/** The dog's bed on the deck (first: it starts there), a spot further out on the deck, one in the break corner and one along the front walkway. */
function dogSpotsFor(inLounge: (x: number, u: number) => Point, promenadeZ: number): DogSpot[] {
  const play: HangoutPose[] = ['petting', 'throwing-ball'];
  const onWalkway = (p: Point) => ({ at: p, link: [p], poses: play });
  const alongside = (name: string, dog: Point, fetch: Point): DogSpot =>
    ({ name, dog, link: [dog], fetch, visitors: [onWalkway({ x: dog.x - 0.6, z: dog.z }), onWalkway({ x: dog.x + 0.6, z: dog.z })] });
  const bed = { x: 11.9, z: -1.0 };
  return [
    {
      name: 'bed',
      dog: bed,
      link: [bed, { x: SPINE_X, z: bed.z }],
      fetch: { x: SPINE_X, z: -5.0 },
      visitors: [
        { at: { x: 13.2, z: bed.z }, link: [{ x: 13.2, z: bed.z }, { x: SPINE_X, z: bed.z }], poses: play },
        { at: { x: SPINE_X, z: -0.35 }, link: [{ x: SPINE_X, z: -0.35 }], poses: ['feeding'] },
      ],
    },
    alongside('deck', { x: 17.0, z: DECK_FRONT_Z }, { x: 13.6, z: DECK_FRONT_Z }),
    alongside('lounge', { x: -5.0, z: promenadeZ }, inLounge(5.6, PROMENADE)),
    alongside('pit', { x: -3.0, z: FRONT_Z }, { x: 3.0, z: FRONT_Z }),
  ];
}
