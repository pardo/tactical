// Mobile UX details: camera framing, chip focus, quit confirmation, collapsed log on phones.
async (page) => {
  const fail = (msg) => {
    throw new Error(`mobile-ux: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Play vs AI' }).tap();
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(200);
  const cam = () => page.evaluate(() => ({ ...window.__tactical.rig.state }));
  const c0 = await cam();
  if (!(c0.x < -1)) fail(`camera not framed on Blue's side (x=${c0.x.toFixed(1)})`);
  if (await page.locator('#log').isVisible()) fail('log should start collapsed on a phone');

  // Second tap on the selected soldier's chip centres the camera on them.
  const chips = page.locator('.chip');
  await chips.nth(2).tap();
  await chips.nth(2).tap();
  const s3 = await page.evaluate(() => {
    const g = window.__tactical.game;
    const s = g.match.world.soldiers.find((x) => x.id === g.planning.state.selectedId);
    return { x: s.x, z: s.z };
  });
  const c1 = await cam();
  if (Math.hypot(c1.x - s3.x, c1.z - s3.z) > 0.01) fail('chip double-tap did not focus the soldier');

  // Quit asks first; "Keep playing" keeps the match.
  await page.getByRole('button', { name: '✕' }).tap();
  await page.waitForTimeout(100);
  if (!(await page.locator('#overlay').innerText()).includes('Quit match?')) fail('no quit confirmation');
  await page.getByRole('button', { name: 'Keep playing' }).tap();
  await page.waitForTimeout(100);
  if (await page.locator('#overlay').isVisible()) fail('overlay still visible after Keep playing');
  if (!(await page.evaluate(() => !!window.__tactical.game))) fail('match ended');
  await page.getByRole('button', { name: '✕' }).tap();
  await page.getByRole('button', { name: 'Quit' }).tap();
  await page.waitForTimeout(100);
  if (!(await page.locator('#overlay').innerText()).includes('TACTICAL')) fail('did not return to menu');
  return 'ok: framing, chip focus, quit confirm, collapsed log';
}
