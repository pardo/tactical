import { describe, expect, it } from 'vitest';
import { validateMapDef } from '../src/maps/validate.js';
import { MAPS } from '../src/maps/index.js';

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
    const rows = box([
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
    ]);
    const r = validateMapDef({ name: 't', rows });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Red needs 4 spawn tiles \(has 3\)/);
    expect(r.errors.join(' ')).toMatch(/unreachable/);
    expect(r.warnings.join(' ')).toMatch(/symmetric/);
  });

  it('rejects ragged rows, odd characters and silly sizes', () => {
    expect(validateMapDef({ rows: ['####', '###'] }).ok).toBe(false);
    expect(validateMapDef({ rows: Array(12).fill('#'.repeat(11) + 'x') }).errors.join()).toMatch(/unknown tile/);
    expect(validateMapDef({ rows: ['###', '###', '###'] }).errors.join()).toMatch(/size/);
  });
});
