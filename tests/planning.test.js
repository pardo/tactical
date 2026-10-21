import { describe, expect, it } from 'vitest';
import { parseMap, cellCenter } from '../src/sim/map.js';
import { createPlanning } from '../src/ui/planning.js';

const map = parseMap({ name: 't', rows: ['########', '#A....B#', '#..##..#', '########'] });
const a = cellCenter(map, 1, 1);
const soldiers = [
  { id: 1, team: 'A', alive: true, ...a },
  { id: 2, team: 'B', alive: true, ...cellCenter(map, 6, 1) },
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
    const c = cellCenter(map, 3, 1);
    expect(p.addWaypoint(c.x, c.z, 'run')).toBe(true);
    const w = cellCenter(map, 3, 2); // wall
    expect(p.addWaypoint(w.x, w.z)).toBe(false);
    const d = cellCenter(map, 5, 2);
    expect(p.addWaypoint(d.x, d.z)).toBe(true);
    expect(drafts[1].map((x) => x.move)).toEqual(['run', 'run']);
    expect(p.state.wpIndex).toBe(1);
  });

  it('actions, picks, wait stacking and undo', () => {
    const { p, drafts } = setup();
    const c = cellCenter(map, 3, 1);
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
    const c = cellCenter(map, 2, 1);
    p.addWaypoint(c.x, c.z);
    p.beginDrag(1, 0);
    const wall = cellCenter(map, 3, 2);
    expect(p.dragWaypointTo(wall.x, wall.z)).toBe(false);
    const ok = cellCenter(map, 2, 2);
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
    const c = cellCenter(map, 3, 1);
    p.clearPlan();
    p.addWaypoint(c.x, c.z);
    p.deselectWaypoint();
    expect(p.canFaceHere).toBe(false);
    p.startPick('faceHere');
    expect(p.state.pickMode).toBeNull();
  });
});

