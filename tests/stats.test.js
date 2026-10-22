import { describe, it, expect } from 'vitest';
import { matchStats, mvp } from '../src/game/stats.js';

const soldiers = [
  { id: 0, team: 'A', alive: true },
  { id: 1, team: 'B', alive: false },
  { id: 2, team: 'A', alive: true },
];

describe('matchStats', () => {
  it('counts shots, hits, damage and credits kills to the last attacker', () => {
    const frames = [
      { soldiers, events: [{ type: 'shot', from: 0, hit: true }, { type: 'damage', id: 1, amount: 30, sourceId: 0 }] },
      { soldiers, events: [{ type: 'shot', from: 2, hit: false }, { type: 'shot', from: 2, hit: true }, { type: 'damage', id: 1, amount: 80, sourceId: 2 }] },
      { soldiers, events: [{ type: 'death', id: 1 }] },
    ];
    const s = matchStats(frames);
    expect(s.get(0)).toEqual({ shots: 1, hits: 1, damage: 30, kills: 0, alive: true });
    expect(s.get(2)).toEqual({ shots: 2, hits: 1, damage: 80, kills: 1, alive: true });
    expect(s.get(1).alive).toBe(false);
    expect(mvp(s)).toBe(2);
  });

  it('self-damage and friendly fire are not credited', () => {
    const frames = [{ soldiers, events: [{ type: 'damage', id: 0, amount: 50, sourceId: 0 }, { type: 'damage', id: 0, amount: 50, sourceId: 2 }, { type: 'death', id: 0 }] }];
    const s = matchStats(frames);
    expect(s.get(0).damage).toBe(0);
    expect(s.get(0).kills).toBe(0);
    expect(s.get(2).damage).toBe(0);
    expect(mvp(s)).toBe(null);
  });
});
