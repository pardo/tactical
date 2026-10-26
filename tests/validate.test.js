import { describe, expect, it } from 'vitest';
import { validateMapDef } from '../src/maps/validate.js';
import { MAPS } from '../src/maps/index.js';
import { thick } from './helpers.js';

const box = (inner) => {
  const W = inner[0].length + 2;
  return ['#'.repeat(W), ...inner.map((r) => `#${r}#`), '#'.repeat(W)];
};

describe('validateMapDef', () => {
  it.each(Object.keys(MAPS))('built-in %s is valid and symmetric', (id) => {
    const r = validateMapDef(MAPS[id]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('reports missing spawns, unreachable floor, bad doors and asymmetry', () => {
    const rows = thick({ rows: box([
      'AA........', //
      'AA...#....',
      '.....#....',
      '#######...',
      '...#D#....',
      '...#.#....',
      '...####...',
      '..........',
      '........BB',
      '........B.',
    ]) }).rows;
    const r = validateMapDef({ name: 't', rows, res: 4 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Red needs 4 spawn tiles \(has 3\)/);
    expect(r.errors.join(' ')).toMatch(/unreachable/);
    expect(r.warnings.join(' ')).toMatch(/symmetric/);
  });

  it('rejects ragged rows, odd characters and silly sizes', () => {
    expect(validateMapDef({ rows: ['####', '###'] }).ok).toBe(false);
    expect(validateMapDef({ rows: Array(12).fill('#'.repeat(11) + 'x') }).errors.join()).toMatch(/unknown tile/);
    expect(validateMapDef({ rows: ['###', '###', '###'] }).errors.join()).toMatch(/size/);
    expect(validateMapDef({ rows: Array(12).fill('#'.repeat(12)), res: 3 }).ok).toBe(false);
  });

  it('rejects doors too narrow to walk through', () => {
    const rows = box(Array(40).fill('.'.repeat(38)));
    const at = (r, x, s) => r.slice(0, x) + s + r.slice(x + s.length);
    rows[5] = at(rows[5], 1, '#'.repeat(17) + 'DD' + '#'.repeat(19));
    rows[2] = at(at(rows[2], 1, 'A.A.A.A'), 33, 'B.B.B.B');
    const r = validateMapDef({ name: 'n', rows, res: 4 });
    expect(r.errors.join(' ')).toMatch(/too narrow/);
  });
});
