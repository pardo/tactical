import { describe, expect, it } from 'vitest';
import { createEditor, blankRows, SIZES } from '../src/ui/editor.js';
import { validateMapDef } from '../src/maps/validate.js';

describe('map editor', () => {
  it.each(SIZES)('a blank %ix%i map is valid and symmetric', (W, H) => {
    const r = validateMapDef({ name: 'b', rows: blankRows(W, H) });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('mirrors every stroke, keeps the border, and undoes per stroke', () => {
    const ed = createEditor({ rows: blankRows(24, 14) });
    ed.beginStroke();
    ed.state.tool = '#';
    for (let x = 5; x < 10; x++) ed.paint(x, 4);
    ed.state.tool = 'D';
    ed.paint(7, 4);
    expect(ed.paint(0, 5)).toBe(false); // border
    const def = ed.toDef();
    expect(def.rows[4].slice(5, 10)).toBe('##D##');
    expect(def.rows[14 - 1 - 4].slice(24 - 10, 24 - 5)).toBe('##D##');
    expect(validateMapDef(def).warnings).toEqual([]);
    ed.undo();
    expect(ed.toDef().rows).toEqual(blankRows(24, 14));
  });

  it('a Blue spawn painted anywhere creates the mirrored Red spawn', () => {
    const ed = createEditor({ rows: blankRows(24, 14) });
    ed.state.tool = 'A';
    ed.paint(3, 3);
    const rows = ed.toDef().rows;
    expect(rows[3][3]).toBe('A');
    expect(rows[14 - 1 - 3][24 - 1 - 3]).toBe('B');
  });
});
