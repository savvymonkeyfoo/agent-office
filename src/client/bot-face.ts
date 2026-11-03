// The Innovation lab's agents are little bots with a screen for a face (#lab). The screen's eyes say
// how the session is going, in the lab's status colours: focused bars while working, big round
// eyes that pulse while it waits on you, happy arcs when it's done, and sleepy lines when it's gone quiet.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { OfficeState } from '../shared/agent.ts';
import { at, ball, cyl, mesh } from './toon.ts';

/** Eye glow per state: the lab's status colours, a step brighter so they read on a dark screen. */
export const BOT_EYES: Record<OfficeState, string> = {
  working: '#5FE39A', needs: '#FFA545', done: '#7FAEFF', finished: '#7FAEFF', stale: '#A8A097',
};
const SCREEN = '#1E2229';
export const BOT_METAL = '#D9D2C7';

/** How each state's eyes sit: round or arcs, and their height (blinks squash it). */
const EYE_SHAPE: Record<OfficeState, { arcs: boolean; height: number; width: number }> = {
  working: { arcs: false, height: 0.55, width: 1.1 },
  needs: { arcs: false, height: 1.25, width: 1.25 },
  done: { arcs: true, height: 1, width: 1 },
  finished: { arcs: true, height: 1, width: 1 },
  stale: { arcs: false, height: 0.14, width: 1.15 },
};

export class BotHead {
  readonly group = new THREE.Group();
  private eyes: THREE.Mesh[];
  private arcs: THREE.Mesh[];
  private glow = new THREE.MeshBasicMaterial({ color: BOT_EYES.working });
  private tip: THREE.Mesh;

  constructor(casing: string) {
    const head = mesh(new RoundedBoxGeometry(0.86, 0.66, 0.5, 4, 0.12), casing, { outline: 0.04 });
    this.group.add(head);
    const screen = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.5, 0.04, 3, 0.06), new THREE.MeshBasicMaterial({ color: SCREEN }));
    this.group.add(at(screen, 0, 0, 0.245));
    // Ear bolts and an antenna whose tip glows with the eyes.
    for (const side of [-1, 1]) {
      const ear = cyl(0.09, 0.09, 0.06, BOT_METAL, { outline: 0.08 });
      ear.rotation.z = Math.PI / 2;
      this.group.add(at(ear, 0.45 * side, 0, 0));
    }
    this.group.add(at(cyl(0.018, 0.018, 0.2, BOT_METAL, { outline: 0.1 }), 0, 0.42, 0));
    this.tip = at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), this.glow), 0, 0.54, 0);
    this.group.add(this.tip);
    this.eyes = [-1, 1].map((side) => {
      const eye = at(new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), this.glow), 0.15 * side, 0.03, 0.268);
      this.group.add(eye);
      return eye;
    });
    this.arcs = [-1, 1].map((side) => {
      const arc = at(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 16, Math.PI), this.glow), 0.15 * side, 0.0, 0.268);
      this.group.add(arc);
      return arc;
    });
  }

  /** Shows `state` on the screen at time `t`; `blinking` squashes the eyes shut. */
  update(state: OfficeState, t: number, blinking: boolean) {
    const shape = EYE_SHAPE[state];
    this.glow.color.set(BOT_EYES[state]);
    // Working eyes glance across the code; waiting eyes pulse.
    const glance = state === 'working' ? Math.sin(t * 0.9) * 0.035 : 0;
    const pulse = state === 'needs' ? 1 + Math.sin(t * 5) * 0.08 : 1;
    this.eyes.forEach((e, i) => {
      e.visible = !shape.arcs;
      e.position.x = (i ? 0.15 : -0.15) + glance;
      e.scale.set(shape.width * pulse, (blinking ? 0.12 : shape.height) * pulse, 1);
    });
    this.arcs.forEach((a) => { a.visible = shape.arcs; });
    this.tip.scale.setScalar(state === 'needs' ? pulse * 1.3 : 1);
  }
}

/** A bot's hand: a round metal mitt. */
export const botHand = () => ball(0.12, BOT_METAL, { outline: 0.08 });
