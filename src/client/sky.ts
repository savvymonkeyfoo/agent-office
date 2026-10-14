import * as THREE from 'three';
import { partsIn, sunTimes, type SunTimes } from './sun-times.ts';

type Rgb = number[];
type Today = Pick<SunTimes, 'rise' | 'set'>;
/** A body's state: how far through its day or night (0..1), whether it is up, and its elevation (-1..1). */
export interface BodyState { progress: number; up: boolean; e: number }

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: Rgb, b: Rgb, k: number) => a.map((v, i) => v + (b[i] - v) * k);
const rgb = (c: Rgb, a = 1) => `rgba(${c.map(Math.round).join(',')},${a})`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => v * v * (3 - 2 * v);

// Sky colours by sun elevation (-1 deep night … 1 noon): [zenith, middle, horizon].
const SKY_STOPS = ([
  [-1.0, '#04051A', '#0A0E2E', '#171C47'],
  [-0.3, '#070923', '#121842', '#272B5E'],
  [-0.14, '#10173F', '#26306C', '#5A4F8E'],
  [-0.04, '#1D2860', '#4E5594', '#D98F8E'],
  [0.05, '#3565AE', '#86A9D8', '#FFCFA2'],
  [0.25, '#3A82D3', '#79B4E8', '#CDE5F4'],
  [1.0, '#2C74CC', '#6CADE8', '#BEDFF5'],
] as const).map(([e, ...colours]) => ({ e, colours: colours.map(hex) }));

/** [zenith, middle, horizon] for a sun elevation, smoothly blended between the stops. */
export function skyColours(e: number): Rgb[] {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    if (e <= SKY_STOPS[i].e) {
      const from = SKY_STOPS[i - 1], to = SKY_STOPS[i];
      const k = smooth(clamp01((e - from.e) / (to.e - from.e)));
      return from.colours.map((c, j) => mix(c, to.colours[j], k));
    }
  }
  return SKY_STOPS.at(-1)!.colours;
}

/** The sun at local `hour`: progress through daylight (rise→set) or through the night (set→rise). */
export function sunState(hour: number, { rise, set }: Today): BodyState {
  const dayLength = (set - rise + 24) % 24;
  const sinceRise = (hour - rise + 24) % 24;
  if (sinceRise < dayLength) {
    const progress = sinceRise / dayLength;
    return { progress, up: true, e: Math.sin(Math.PI * progress) };
  }
  const progress = (sinceRise - dayLength) / (24 - dayLength);
  return { progress, up: false, e: -Math.sin(Math.PI * progress) };
}

/** The moon crosses while the sun is down (no phases or real moonrise, on purpose). */
export const moonState = (sun: BodyState): BodyState => ({ progress: sun.progress, up: !sun.up, e: -sun.e });

/**
 * A wide, shallow path: in from beyond the left edge, up across the sky, down past the right edge.
 * Below the horizon a body waits just off the side it set on, then the side it will rise on, so its glow shows there.
 */
export function skyPath(body: BodyState, W: number, H: number) {
  const lowY = H * 0.5, highY = H * 0.14;
  if (!body.up) return { x: W * (body.progress < 0.5 ? 1.1 : -0.1), y: lowY, up: false };
  return { x: W * (-0.1 + 1.2 * body.progress), y: lowY - (lowY - highY) * Math.sin(Math.PI * body.progress), up: true };
}

/** How much of the starry night shows (0 by day, 1 in deep night), from the sun's elevation. */
export const starVisibility = (sunE: number) => clamp01((-sunE - 0.02) / 0.25);

/** Local hour and today's sunrise/sunset in `zone`, recomputed when the date there changes. */
export function createSunClock(zone: string) {
  let day = '', today: SunTimes;
  return {
    at(date: Date) {
      const { year, month, day: dayOfMonth, hour } = partsIn(zone, date);
      const key = `${year}-${month}-${dayOfMonth}`;
      if (key !== day) { day = key; today = sunTimes(zone, date); }
      return { hour, today };
    },
  };
}

const rand = ((seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(11);

// --- clouds, birds and shooting stars -------------------------------------------

/** Each cloud is pre-painted in these [lit top, shaded underside] colours and blended by the time of day. */
const CLOUD_TINTS = { day: ['#FFFFFF', '#C3D2E8'], sunset: ['#FFD9B0', '#B4708E'], night: ['#3B4374', '#191D44'] };
export type CloudTint = keyof typeof CLOUD_TINTS;
/** A cloud sprite's size in px; `base` is its flat bottom, as a share of its height. Nothing is painted below it. */
export const CLOUD_SPRITE = { w: 420, h: 240, base: 0.78 };
/** The blur (px) that softens the puffs' edges; it spreads about three times this far. */
export const PUFF_BLUR = 2;
const PUFF_MARGIN = PUFF_BLUR * 3 + 2;

export type Puff = [x: number, y: number, r: number];
export type Cloud = ReturnType<typeof createClouds>[number];

/** Six soft cumulus, each a row of puffs that sit on a flat base and stay inside the sprite, so none is clipped. */
export function createClouds(random = rand) {
  const { w, h, base } = CLOUD_SPRITE;
  return Array.from({ length: 6 }, (_, i) => {
    const count = 9 + Math.floor(random() * 8);
    const puffs = Array.from({ length: count }, (_, j): Puff => {
      const t = j / (count - 1), r = 26 + Math.sin(Math.PI * t) * (34 + random() * 30);
      const x = 40 + t * (w - 80) + (random() - 0.5) * 20, y = h * base - r * (0.55 + random() * 0.3);
      return [x, y, Math.min(r, x - PUFF_MARGIN, w - PUFF_MARGIN - x, y - PUFF_MARGIN)];
    });
    return {
      puffs,
      x: random(), // share of the loop it drifts round
      y: 0.04 + (i % 3) * 0.1 + random() * 0.06, // share of the sky's height
      scale: 0.15 + random() * 0.12, // width as a share of the sky's
      speed: 0.004 + random() * 0.005, // loops per second
    };
  });
}

/** Where a cloud is drawn: drifting round a loop a little wider than the sky, its flat bottom always in the upper half. */
export function cloudPlacement(cloud: Cloud, seconds: number, W: number, H: number) {
  const w = W * cloud.scale, h = w * (CLOUD_SPRITE.h / CLOUD_SPRITE.w);
  const x = ((cloud.x + seconds * cloud.speed) % 1) * (W + w * 2) - w;
  const y = Math.min(cloud.y * H, H / 2 - h * CLOUD_SPRITE.base);
  return { x, y, w, h };
}

/** How strongly each tint shows for a sun elevation: white by day, peach and pink around sunset, faint blue at night. */
export function cloudTints(sunE: number): Record<CloudTint, number> {
  const sunset = Math.exp(-(((sunE - 0.02) / 0.16) ** 2));
  return { day: clamp01(sunE * 4) * (1 - sunset * 0.6), sunset, night: starVisibility(sunE) * 0.4 };
}

/** One bird of a flock, in shares of the sky's width and height. */
export interface Bird { x: number; y: number; size: number; phase: number }
/** A shooting star `t` (0..1) of the way through its 0.9 s, starting at x, y (shares of the sky) and heading along `angle`. */
export interface ShootingStar { x: number; y: number; angle: number; t: number }

/** The sky's occasional visitors: a flock of birds by day, a shooting star by night. */
export function createVisitors(random = rand) {
  const flock = { start: -1, next: 3, y: 0, direction: 1, birds: [] as { back: number; side: number; phase: number; size: number }[] };
  const meteor = { start: -1, next: 4, x: 0, y: 0, angle: 0 };
  return {
    /** The flock crossing now (3–7 birds in a loose V, about 16 s to cross, every 6–18 s); empty when none, or the sun is down. */
    birds(seconds: number, sunE: number): Bird[] {
      if (sunE <= 0) { flock.start = -1; return []; }
      if (flock.start < 0 && seconds > flock.next && sunE > 0.08) {
        const count = 3 + Math.floor(random() * 5);
        flock.birds = Array.from({ length: count }, (_, i) => ({
          back: Math.ceil(i / 2) * 0.035, side: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.022,
          phase: random() * Math.PI * 2, size: 0.8 + random() * 0.4,
        }));
        Object.assign(flock, { start: seconds, y: 0.12 + random() * 0.22, direction: random() < 0.5 ? 1 : -1 });
      }
      if (flock.start < 0) return [];
      const t = (seconds - flock.start) / 16;
      if (t > 1) { flock.start = -1; flock.next = seconds + 6 + random() * 12; return []; }
      const lead = flock.direction > 0 ? -0.15 + t * 1.3 : 1.15 - t * 1.3;
      return flock.birds.map((b) => ({
        x: lead - flock.direction * b.back,
        y: flock.y + b.side + 0.01 * Math.sin(seconds * 1.3 + b.phase),
        size: b.size, phase: b.phase,
      }));
    },
    /** The shooting star now (one every 5–14 s while the stars are out); null when none, or the stars are hidden. */
    shootingStar(seconds: number, visibility: number): ShootingStar | null {
      if (visibility <= 0) { meteor.start = -1; return null; }
      if (meteor.start < 0 && seconds > meteor.next && visibility > 0.6) {
        Object.assign(meteor, { start: seconds, x: 0.15 + random() * 0.7, y: 0.05 + random() * 0.25, angle: 0.35 + random() * 0.5 });
      }
      if (meteor.start < 0) return null;
      const t = (seconds - meteor.start) / 0.9;
      if (t > 1) { meteor.start = -1; meteor.next = seconds + 5 + random() * 9; return null; }
      return { x: meteor.x, y: meteor.y, angle: meteor.angle, t };
    },
  };
}

// --- drawing -----------------------------------------------------------------

function offscreen(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d')!, w, h);
  return c;
}

/** Soft round star sprites in three tints; the bright one gets faint diffraction spikes. */
function starSprites() {
  const tints = ['#FFFFFF', '#CFE0FF', '#FFE6C4'].map((tint) => offscreen(32, 32, (g) => {
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, tint); r.addColorStop(0.18, tint); r.addColorStop(0.45, tint + '40'); r.addColorStop(1, tint + '00');
    g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  }));
  const bright = offscreen(48, 48, (g) => {
    g.drawImage(tints[0], 8, 8);
    const spike = (x0: number, y0: number, x1: number, y1: number) => {
      const l = g.createLinearGradient(x0, y0, x1, y1);
      l.addColorStop(0, '#FFFFFF00'); l.addColorStop(0.5, '#FFFFFFAA'); l.addColorStop(1, '#FFFFFF00');
      g.strokeStyle = l; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    };
    spike(0, 24, 48, 24); spike(24, 0, 24, 48);
  });
  return { tints, bright };
}

function createStars() {
  const sprites = starSprites();
  return Array.from({ length: 700 }, () => {
    const bright = rand() < 0.04;
    return {
      radius: Math.sqrt(rand()),
      angle: rand() * Math.PI * 2,
      size: bright ? 1 : 0.25 + Math.pow(rand(), 3) * 0.6,
      sprite: bright ? sprites.bright : sprites.tints[rand() < 0.7 ? 0 : rand() < 0.5 ? 1 : 2],
      twinkleSpeed: 1 + rand() * 3,
      twinklePhase: rand() * Math.PI * 2,
    };
  });
}

/** One cloud's puffs merged into a soft silhouette, lit bright on top and shaded underneath, cut flat at its base. */
function paintCloud(g: CanvasRenderingContext2D, w: number, h: number, puffs: Puff[], [light, shade]: string[]) {
  const base = h * CLOUD_SPRITE.base;
  g.filter = `blur(${PUFF_BLUR}px)`;
  g.fillStyle = light;
  for (const [x, y, r] of puffs) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.filter = 'none';
  const top = Math.min(...puffs.map(([, y, r]) => y - r));
  const shading = g.createLinearGradient(0, top, 0, base);
  shading.addColorStop(0, light); shading.addColorStop(0.45, light); shading.addColorStop(1, shade);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = shading; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  const cut = g.createLinearGradient(0, base - 4, 0, base + 6);
  cut.addColorStop(0, 'rgba(0,0,0,0)'); cut.addColorStop(1, '#000');
  g.fillStyle = cut; g.fillRect(0, base - 4, w, h);
  g.globalCompositeOperation = 'source-over';
}

const cloudSprites = (puffs: Puff[]) => Object.fromEntries(Object.entries(CLOUD_TINTS).map(([tint, colours]) =>
  [tint, offscreen(CLOUD_SPRITE.w, CLOUD_SPRITE.h, (g, w, h) => paintCloud(g, w, h, puffs, colours))])) as Record<CloudTint, HTMLCanvasElement>;

/** Fine grain laid over the whole sky so the gradients don't band. */
const grain = () => offscreen(160, 160, (g, w, h) => {
  const img = g.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = rand() * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
});

/**
 * The living sky, painted on a 2D canvas used as the scene's background texture, so it stays fixed on screen
 * while the camera moves.
 */
export function createSky() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const stars = createStars();
  const clouds = createClouds().map((cloud) => ({ ...cloud, sprites: cloudSprites(cloud.puffs) }));
  const visitors = createVisitors();
  const grainPattern = ctx.createPattern(grain(), 'repeat')!;
  let W = 1, H = 1;

  /** A radial glow squashed into an ellipse, for light that spreads along the horizon. */
  function ellipseGlow(cx: number, cy: number, rx: number, ry: number, stops: [number, string][]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx / ry, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    for (const [at, colour] of stops) g.addColorStop(at, colour);
    ctx.fillStyle = g;
    ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
    ctx.restore();
  }

  function drawGradient([zenith, middle, horizon]: Rgb[]) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(zenith));
    g.addColorStop(0.5, rgb(middle));
    g.addColorStop(0.85, rgb(horizon));
    g.addColorStop(1, rgb(mix(horizon, middle, 0.3)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawStars(hour: number, today: Today, seconds: number, visibility: number) {
    if (visibility < 0.01) return;
    const poleX = W * 0.5, poleY = -H * 0.35;
    const reach = Math.hypot(W * 0.6, H * 1.4);
    const turn = (((hour - today.set + 24) % 24) * 8 * Math.PI) / 180; // 8° an hour: slower than the real 15°, so it reads as drift
    const scale = W / 900;
    for (const s of stars) {
      const a = s.angle + turn;
      const x = poleX + Math.cos(a) * s.radius * reach;
      const y = poleY + Math.sin(a) * s.radius * reach;
      if (x < -10 || x > W + 10 || y < -10 || y > H) continue;
      const twinkle = 0.6 + 0.4 * Math.sin(seconds * s.twinkleSpeed + s.twinklePhase);
      const thinnerLow = clamp01((H * 0.85 - y) / (H * 0.35)); // stars dim into the haze near the horizon
      ctx.globalAlpha = visibility * twinkle * thinnerLow;
      const size = s.sprite.width * 0.5 * s.size * scale;
      ctx.drawImage(s.sprite, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  /** Sunrise and sunset: warm light spreads along the horizon on the sun's side; a pink band rises on the other. */
  function drawTwilight(sun: { x: number; y: number }, e: number) {
    const strength = Math.exp(-(((e + 0.02) / 0.2) ** 2));
    if (strength < 0.01) return;
    ellipseGlow(sun.x, Math.min(sun.y, H * 0.5), W, H * 0.75, [
      [0, `rgba(255, 210, 140, ${0.9 * strength})`],
      [0.2, `rgba(255, 150, 90, ${0.6 * strength})`],
      [0.55, `rgba(220, 100, 130, ${0.25 * strength})`],
      [1, 'rgba(220, 100, 130, 0)'],
    ]);
    const oppositeX = sun.x < W / 2 ? W * 1.05 : -W * 0.05;
    ellipseGlow(oppositeX, H * 0.74, W * 0.8, H * 0.18, [
      [0, `rgba(238, 160, 190, ${0.35 * strength})`],
      [1, 'rgba(238, 160, 190, 0)'],
    ]);
  }

  function drawSun(sun: { x: number; y: number }, e: number) {
    const low = 1 - clamp01(e / 0.35); // 1 at the horizon, 0 once well up
    const size = W * 0.034 * (1 + 0.15 * low);
    ellipseGlow(sun.x, sun.y, W * 0.28, W * 0.28, [
      [0, `rgba(255, 245, 210, ${0.55 - 0.15 * low})`],
      [0.25, 'rgba(255, 225, 170, 0.18)'],
      [1, 'rgba(255, 225, 170, 0)'],
    ]);
    const edge = mix(hex('#FFE9A8'), hex('#FF8A3D'), low), core = mix(hex('#FFFDF2'), hex('#FFD08A'), low);
    const disc = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, size);
    disc.addColorStop(0, rgb(core)); disc.addColorStop(0.75, rgb(mix(core, edge, 0.6))); disc.addColorStop(1, rgb(edge));
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(sun.x, sun.y, size, 0, Math.PI * 2); ctx.fill();
  }

  function drawMoon(moon: { x: number; y: number }, e: number, nightness: number) {
    const low = 1 - clamp01(e / 0.3);
    const size = W * 0.028;
    const tint = mix(hex('#F4F0E2'), hex('#F2C894'), low * 0.7);
    ellipseGlow(moon.x, moon.y, W * 0.2, W * 0.2, [
      [0, rgb(tint, 0.28 * nightness)], [0.3, rgb(tint, 0.08 * nightness)], [1, rgb(tint, 0)],
    ]);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.65 * nightness; // a pale moon at the very ends of the night
    const disc = ctx.createRadialGradient(moon.x - size * 0.3, moon.y - size * 0.3, 0, moon.x, moon.y, size);
    disc.addColorStop(0, rgb(mix(tint, [255, 255, 255], 0.5))); disc.addColorStop(1, rgb(mix(tint, hex('#B9B2A0'), 0.35)));
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(moon.x, moon.y, size, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150, 140, 120, 0.28)';
    for (const [dx, dy, r] of [[-0.3, -0.15, 0.24], [0.28, 0.3, 0.15], [0.2, -0.42, 0.1], [-0.05, 0.45, 0.12]]) {
      ctx.beginPath(); ctx.arc(moon.x + dx * size, moon.y + dy * size, r * size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawShootingStar(star: ShootingStar | null, visibility: number) {
    if (!star) return;
    const travel = W * 0.22 * star.t, tail = W * 0.12 * Math.sin(Math.PI * star.t);
    const dx = Math.cos(star.angle), dy = Math.sin(star.angle);
    const hx = star.x * W + dx * travel, hy = star.y * H + dy * travel;
    const g = ctx.createLinearGradient(hx, hy, hx - dx * tail, hy - dy * tail);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * visibility})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - dx * tail, hy - dy * tail); ctx.stroke();
  }

  function drawClouds(seconds: number, sunE: number) {
    const tints = Object.entries(cloudTints(sunE)) as [CloudTint, number][];
    for (const cloud of clouds) {
      const { x, y, w, h } = cloudPlacement(cloud, seconds, W, H);
      for (const [tint, weight] of tints) {
        if (weight < 0.01) continue;
        ctx.globalAlpha = Math.min(1, weight) * 0.95;
        ctx.drawImage(cloud.sprites[tint], x, y, w, h);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBirds(birds: Bird[], seconds: number) {
    ctx.strokeStyle = 'rgba(40, 38, 64, 0.75)';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.2, W * 0.0018);
    for (const b of birds) {
      const x = b.x * W, y = b.y * H;
      const span = W * 0.009 * b.size, flap = Math.sin(seconds * 9 + b.phase) * span * 0.6;
      ctx.beginPath();
      ctx.moveTo(x - span, y - flap); ctx.quadraticCurveTo(x - span * 0.4, y - flap * 0.2 - span * 0.25, x, y);
      ctx.quadraticCurveTo(x + span * 0.4, y - flap * 0.2 - span * 0.25, x + span, y - flap);
      ctx.stroke();
    }
  }

  function drawFinish(nightness: number) {
    ellipseGlow(W / 2, H * 0.45, W * 0.8, H * 0.8, [[0.55, 'rgba(0,0,12,0)'], [1, `rgba(0,0,12,${0.35 * nightness})`]]);
    ctx.save();
    ctx.globalAlpha = 0.035;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  return {
    texture,
    /** Match the screen, in CSS pixels: the sky is soft enough not to need the device's full resolution. */
    resize(width: number, height: number) {
      const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
      if (w === canvas.width && h === canvas.height) return;
      W = canvas.width = w;
      H = canvas.height = h;
      texture.dispose(); // GPU storage is fixed-size: drop it so the next frame uploads at the new size
    },
    draw(hour: number, today: Today, seconds: number) {
      const sunNow = sunState(hour, today), moonNow = moonState(sunNow);
      const sun = skyPath(sunNow, W, H), moon = skyPath(moonNow, W, H);
      const nightness = starVisibility(sunNow.e);
      drawGradient(skyColours(sunNow.e));
      drawStars(hour, today, seconds, nightness);
      drawShootingStar(visitors.shootingStar(seconds, nightness), nightness);
      drawTwilight(sun, sunNow.e);
      if (moon.up) drawMoon(moon, moonNow.e, nightness);
      if (sun.up) drawSun(sun, sunNow.e);
      drawClouds(seconds, sunNow.e);
      drawBirds(visitors.birds(seconds, sunNow.e), seconds);
      drawFinish(nightness);
      texture.needsUpdate = true;
    },
  };
}
