import { describe, expect, it } from 'vitest';
import { parseMap } from '../src/sim/map.js';
import { metre, thick } from './helpers.js';
import { createPlanning } from '../src/ui/planning.js';

const map = parseMap(thick({ name: 't', rows: ['########', '#A....B#', '#..##..#', '########'] }));
const a = metre(map, 1, 1);
const soldiers = [
  { id: 1, team: 'A', alive: true, ...a },
  { id: 2, team: 'B', alive: true, ...metre(map, 6, 1) },
];

function setup() {
  const drafts = { 1: [] };
  const p = createPlanning(map);
  p.begin('A', drafts, () => soldiers);
  return { p, drafts };
}

describe('planning', () => {
  it('auto-selects the first own soldier and refuses enemies', () => {
    const { p } = setup();
    expect(p.state.selectedId).toBe(1);
    expect(p.selectSoldier(2)).toBe(false);
  });

  it('adds waypoints that inherit move mode, rejects walls', () => {
    const { p, drafts } = setup();
    const c = metre(map, 3, 1);
    expect(p.addWaypoint(c.x, c.z, 'run')).toBe(true);
    const w = metre(map, 3, 2); // wall
    expect(p.addWaypoint(w.x, w.z)).toBe(false);
    const d = metre(map, 5, 2);
    expect(p.addWaypoint(d.x, d.z)).toBe(true);
    expect(drafts[1].map((x) => x.move)).toEqual(['run', 'run']);
    expect(p.state.wpIndex).toBe(1);
  });

  it('actions, picks, wait stacking and undo', () => {
    const { p, drafts } = setup();
    const c = metre(map, 3, 1);
    p.addWaypoint(c.x, c.z);
    p.addAction({ type: 'stance', stance: 'crouch' });
    p.addAction({ type: 'wait', t: 1 });
    p.addAction({ type: 'wait', t: 1 });
    p.startPick('grenade:frag');
    p.applyPick(5, 0);
    expect(drafts[1][0].actions).toEqual([
      { type: 'stance', stance: 'crouch' },
      { type: 'wait', t: 2 },
      { type: 'grenade', kind: 'frag', x: 5, z: 0 },
    ]);
    p.undo();
    expect(drafts[1][0].actions).toHaveLength(2);
    while (p.undo());
    expect(drafts[1]).toHaveLength(0);
  });

  it('dragging keeps waypoints on walkable, reachable ground', () => {
    const { p, drafts } = setup();
    const c = metre(map, 2, 1);
    p.addWaypoint(c.x, c.z);
    p.beginDrag(1, 0);
    const wall = metre(map, 3, 2);
    expect(p.dragWaypointTo(wall.x, wall.z)).toBe(false);
    const ok = metre(map, 2, 2);
    expect(p.dragWaypointTo(ok.x, ok.z)).toBe(true);
    expect(drafts[1][0]).toMatchObject({ x: ok.x, z: ok.z });
    p.undo();
    expect(drafts[1][0]).toMatchObject({ x: c.x, z: c.z });
  });

  it('Face turns a soldier in place without a waypoint, and can re-aim it', () => {
    const { p, drafts } = setup();
    expect(p.canFaceHere).toBe(true);
    p.startPick('faceHere');
    expect(p.applyPick(a.x + 3, a.z)).toBe(true);
    expect(drafts[1]).toHaveLength(1);
    expect(drafts[1][0]).toMatchObject({ x: a.x, z: a.z, actions: [{ type: 'face', x: a.x + 3, z: a.z }] });
    // Again: replaces the angle instead of stacking waypoints.
    p.startPick('faceHere');
    p.applyPick(a.x, a.z + 1);
    expect(drafts[1]).toHaveLength(1);
    expect(drafts[1][0].actions).toEqual([{ type: 'face', x: a.x, z: a.z + 1 }]);
    p.undo();
    expect(drafts[1][0].actions[0].x).toBe(a.x + 3);
    // With a real move planned, Face belongs on a waypoint instead.
    const c = metre(map, 3, 1);
    p.clearPlan();
    p.addWaypoint(c.x, c.z);
    p.deselectWaypoint();
    expect(p.canFaceHere).toBe(false);
    p.startPick('faceHere');
    expect(p.state.pickMode).toBeNull();
  });

  it('gives orders where the soldier stands, before a planned move, without placing a waypoint', () => {
    const { p, drafts } = setup();
    const c = metre(map, 3, 1);
    p.addWaypoint(c.x, c.z);
    p.deselectWaypoint();
    // Throw first: a "here" waypoint goes in front of the move, holding the grenade.
    expect(p.selectHere()).toBe(true);
    p.startPick('grenade:frag');
    expect(p.applyPick(a.x + 4, a.z)).toBe(true);
    expect(drafts[1]).toHaveLength(2);
    expect(drafts[1][0]).toMatchObject({ x: a.x, z: a.z, actions: [{ type: 'grenade', kind: 'frag' }] });
    expect(p.isHere(0)).toBe(true);
    expect(p.isHere(1)).toBe(false);
    // More orders reuse it; one undo per order.
    p.deselectWaypoint();
    p.selectHere();
    p.addAction({ type: 'stance', stance: 'crouch' });
    expect(drafts[1]).toHaveLength(2);
    expect(drafts[1][0].actions).toHaveLength(2);
    p.undo();
    expect(drafts[1][0].actions).toHaveLength(1);
    p.undo();
    expect(drafts[1]).toHaveLength(1);
    expect(drafts[1][0]).toMatchObject({ x: c.x, z: c.z });
  });

  it('drops a fresh "here" waypoint when its order is cancelled', () => {
    const { p, drafts } = setup();
    const c = metre(map, 3, 1);
    p.addWaypoint(c.x, c.z);
    const undos = p.state.undoStack.length;
    p.selectHere();
    p.startPick('grenade:smoke');
    p.cancelPick();
    expect(drafts[1]).toHaveLength(1);
    expect(p.state.undoStack).toHaveLength(undos);
    expect(p.state.wpIndex).toBeNull();
    // Tapping a waypoint handle meanwhile still selects the waypoint that was tapped.
    p.selectHere();
    p.startPick('grenade:smoke');
    p.selectWaypoint(1, 1);
    expect(drafts[1]).toHaveLength(1);
    expect(p.selectedWaypoint).toMatchObject({ x: c.x, z: c.z });
  });
});
