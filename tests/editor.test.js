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
    const [W, H] = [ed.width, ed.height]; // tiles: 4 per metre
    const before = ed.toDef().rows;
    ed.beginStroke();
    // A thin wall (¼ m brush) with a 1 m door in it.
    ed.state.brush = 1;
    ed.state.tool = '#';
    for (let x = 20; x < 40; x++) ed.paint(x, 16);
    ed.state.brush = 4;
    ed.state.tool = 'D';
    ed.paint(29, 16); // snaps to the metre block x 28–31, rows 16–19
    ed.state.brush = 1;
    ed.state.tool = '#';
    for (let z = 17; z < 20; z++) for (let x = 28; x < 32; x++) ed.paint(x, z); // keep the door one tile thick
    expect(ed.paint(0, 5)).toBe(false); // border
    const def = ed.toDef();
    expect(def.res).toBe(4);
    expect(def.rows[16].slice(20, 40)).toBe('#'.repeat(8) + 'DDDD' + '#'.repeat(8));
    expect(def.rows[H - 1 - 16].slice(W - 40, W - 20)).toBe('#'.repeat(8) + 'DDDD' + '#'.repeat(8));
    expect(validateMapDef(def).warnings).toEqual([]);
    ed.undo();
    expect(ed.toDef().rows).toEqual(before);
  });

  it('a Blue spawn painted anywhere creates the mirrored Red spawn', () => {
    const ed = createEditor({ rows: blankRows(24, 14) });
    const [W, H] = [ed.width, ed.height];
    ed.state.tool = 'A';
    ed.paint(13, 13); // 1 m brush: one spawn tile inside the block 12–15
    const rows = ed.toDef().rows;
    expect(rows[13][13]).toBe('A');
    expect(rows[H - 1 - 13][W - 1 - 13]).toBe('B');
    expect(rows[12].slice(12, 16) + rows[14].slice(12, 16)).toBe('........');
  });
});
