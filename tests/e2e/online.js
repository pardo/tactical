// Two tabs play an online match over Trystero (needs internet for the signalling relays).
async (page) => {
  const fail = (msg) => {
    throw new Error(`online: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: /Online/ }).tap();
  await page.getByRole('button', { name: /Create room/ }).tap();
  const code = (await page.locator('#overlay h2').innerText()).replace('Room ', '').trim();
  if (!/^[A-Z0-9]{5}$/.test(code)) fail(`bad room code "${code}"`);

  const guest = await page.context().newPage();
  await guest.goto(`http://localhost:5173/?room=${code}`);

  const waitFor = async (p, fn, what, ms = 60000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await p.evaluate(fn).catch(() => false)) return;
      await p.waitForTimeout(500);
    }
    fail(`timed out waiting for ${what}`);
  };
  await waitFor(page, () => document.querySelector('#overlay')?.innerText.includes('Opponent connected'), 'host to see guest');
  await waitFor(guest, () => document.querySelector('#overlay')?.innerText.includes('Opponent connected'), 'guest to see host');

  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await guest.getByRole('button', { name: 'Deploy ▶' }).tap();
  const phase = (p) => p.evaluate(() => window.__tactical.game?.match.phase ?? null);
  await waitFor(page, () => window.__tactical.game?.match.phase === 'planning', 'host match start', 20000);
  await waitFor(guest, () => window.__tactical.game?.match.phase === 'planning', 'guest match start', 20000);

  // Each side adds a waypoint for its first soldier, then GO.
  for (const p of [page, guest]) {
    await p.touchscreen.tap(180, 360);
    await p.waitForTimeout(100);
    await p.getByRole('button', { name: 'GO ▶' }).tap();
  }
  await waitFor(page, () => window.__tactical.game.match.turn === 2, 'host turn 2', 30000);
  await waitFor(guest, () => window.__tactical.game.match.turn === 2, 'guest turn 2', 30000);
  await page.waitForTimeout(1000);

  const summary = (p) =>
    p.evaluate(() => {
      const g = window.__tactical.game;
      const soldiers = g.match.world.soldiers.map((s) => [s.id, s.x.toFixed(6), s.z.toFixed(6), s.hp]);
      return { team: g.match.localTeam, soldiers: JSON.stringify(soldiers), msg: !!g.netMessage };
    });
  const [h, gs] = [await summary(page), await summary(guest)];
  if (h.team !== 'A' || gs.team !== 'B') fail(`teams ${h.team}/${gs.team}`);
  if (h.soldiers !== gs.soldiers) fail('worlds diverged after turn 1');
  if (h.msg || gs.msg) fail('a net error message is showing');
  await guest.close();
  return `ok: room ${code}, both peers identical after turn 1 (${await phase(page)})`;
}
