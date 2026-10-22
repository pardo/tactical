// Mobile UX details: camera framing, chip focus, quit confirmation, collapsed log on phones.
async (page) => {
  const fail = (msg) => {
    throw new Error(`mobile-ux: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Play vs AI' }).tap();
  // Layout: nothing wider than the phone screen.
  const setupFits = await page.evaluate(() => {
    const r = document.querySelector('#overlay .card').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  });
  if (!setupFits) fail('setup card overflows the screen');
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(400);
  const chipsFit = await page.evaluate(() => {
    const c = document.querySelector('#bottom .chips');
    return c.scrollWidth <= c.clientWidth && document.querySelector('#bottom .bar .go').getBoundingClientRect().right <= innerWidth;
  });
  if (!chipsFit) fail('soldier chips or GO button do not fit');
  // A very long status line must not push the top buttons off-screen.
  await page.evaluate(() => window.__tactical.ui && (document.querySelector('#top .status').textContent = 'Replay · turn 12 · 4.9s · a very long status line\nBlue 4 · Red 4 · zone 12–19/20s'));
  const quitVisible = await page.evaluate(() => document.querySelector('[data-action=quit]').getBoundingClientRect().right <= innerWidth);
  if (!quitVisible) fail('long status pushes the top buttons off-screen');
  const cam = () => page.evaluate(() => ({ ...window.__tactical.rig.state }));
  const c0 = await cam();
  if (!(c0.x < -1)) fail(`camera not framed on Blue's side (x=${c0.x.toFixed(1)})`);
  if (await page.locator('#log').isVisible()) fail('log should start collapsed on a phone');

  // Second tap on the selected soldier's chip centres the camera on them.
  const chips = page.locator('.chip');
  await chips.nth(2).tap();
  await chips.nth(2).tap();
  await page.waitForFunction(() => !window.__tactical.rig.gliding(), null, { timeout: 8000 }); // the camera glides there
  const s3 = await page.evaluate(() => {
    const g = window.__tactical.game;
    const s = g.match.world.soldiers.find((x) => x.id === g.planning.state.selectedId);
    return { x: s.x, z: s.z };
  });
  const c1 = await cam();
  if (Math.hypot(c1.x - s3.x, c1.z - s3.z) > 0.01) fail('chip double-tap did not focus the soldier');

  // Quit asks first; "Keep playing" keeps the match.
  await page.getByRole('button', { name: '✕' }).tap();
  await page.waitForTimeout(400);
  if (!(await page.locator('#overlay').innerText()).includes('Quit match?')) fail('no quit confirmation');
  await page.getByRole('button', { name: 'Keep playing' }).tap();
  await page.waitForTimeout(400);
  if (await page.locator('#overlay').isVisible()) fail('overlay still visible after Keep playing');
  if (!(await page.evaluate(() => !!window.__tactical.game))) fail('match ended');
  await page.getByRole('button', { name: '✕' }).tap();
  await page.getByRole('button', { name: 'Quit' }).tap();
  await page.waitForTimeout(400);
  if (!(await page.locator('#overlay').innerText()).includes('TACTICAL')) fail('did not return to menu');
  return 'ok: layout fits, framing, chip focus, quit confirm, collapsed log';
}
