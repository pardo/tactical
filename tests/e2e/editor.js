// Map editor on a phone: paint by dragging, symmetry, validation, save, then play the map.
async (page) => {
  const fail = (msg) => {
    throw new Error(`editor: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: /Map editor/ }).tap();
  await page.waitForTimeout(300);
  const state = () =>
    page.evaluate(() => {
      const e = window.__tactical.editor;
      return { rows: e.editor.toDef().rows, ok: e.validation.ok, errors: e.validation.errors, warnings: e.validation.warnings, name: e.editor.state.name };
    });
  let s = await state();
  if (!s.ok || s.name !== 'Killhouse copy') fail(`starts as an invalid map or wrong name: ${JSON.stringify(s)}`);

  // New blank map, then paint a wall stroke with one finger.
  await page.getByRole('button', { name: '🆕 New size' }).tap(); // 32×18 → 40×22
  await page.getByRole('button', { name: '🆕 New size' }).tap(); // → 24×14 m (96×56 tiles of ¼ m)
  s = await state();
  if (s.rows.length !== 56 || s.rows[0].length !== 96) fail(`size not 96×56 tiles: ${s.rows[0].length}×${s.rows.length}`);
  await page.getByRole('button', { name: '▉ Wall' }).tap();
  const toScreen = (x, z) =>
    page.evaluate(
      ([x, z]) => {
        const t = window.__tactical;
        const v = t.view.camera.position.clone().set(x, 0, z).project(t.view.camera);
        const r = document.querySelector('#app').getBoundingClientRect();
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
      },
      [x, z],
    );
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 3 }] });
  // Metre row 3 (z = -3.5, tile rows 12..15), from x = -8.5 to x = -2.5 (metres 3..9, tiles 12..39).
  const a = await toScreen(-8.5, -3.5);
  const b = await toScreen(-2.5, -3.5);
  await touch('touchStart', a);
  for (let i = 1; i <= 12; i++) await touch('touchMove', { x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12 });
  await touch('touchEnd');
  await page.waitForTimeout(400);
  s = await state();
  if (!/#{20,}/.test(s.rows[13].slice(12, 40))) fail(`stroke not painted: ${s.rows[13]}`);
  if (s.rows[56 - 1 - 13] !== [...s.rows[13]].reverse().join('').replace(/A/g, 'B')) fail('stroke not mirrored');
  if (!s.ok || s.warnings.length) fail(`painted map should stay valid and symmetric: ${JSON.stringify(s)}`);

  // A full-height wall splits the map → validation complains; undo fixes it.
  await page.evaluate(() => {
    const E = window.__tactical.editor.editor;
    E.beginStroke();
    E.state.tool = '#';
    for (let z = 0; z < 14; z++) E.paint(11 * 4, z * 4); // metre column 11, 1 m brush
  });
  await page.waitForTimeout(400);
  s = await state();
  if (s.ok || !s.errors.some((e) => /unreachable/.test(e))) fail(`split map not reported: ${JSON.stringify(s.errors)}`);
  if (!(await page.locator('#bottom .panel').innerText()).includes('unreachable')) fail('error not shown in panel');
  await page.getByRole('button', { name: '↶' }).tap();
  await page.waitForTimeout(400); // validation is recomputed on the next frame
  if (!(await state()).ok) fail('undo did not restore a valid map');

  // Name it, save, test-play.
  await page.locator('.map-name').fill('Phone test');
  await page.getByRole('button', { name: '▶ Test vs AI' }).tap();
  await page.waitForTimeout(400);
  const setup = await page.locator('#overlay .card').innerText();
  if (!setup.includes('★ Phone test')) fail(`custom map not selected in setup: ${setup}`);
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => ({ name: window.__tactical.game.match.map.name, w: window.__tactical.game.match.map.width, phase: window.__tactical.game.match.phase }));
  if (m.name !== 'Phone test' || m.w !== 96 || m.phase !== 'planning') fail(`not playing the custom map: ${JSON.stringify(m)}`);
  return 'ok: drag-paint mirrored, validation + undo, save, playing "Phone test" 24×14';
}
