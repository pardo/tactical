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

  // The guest reloads mid-match: it must rejoin, catch up by re-simulation, and keep playing.
  await guest.goto(`http://localhost:5173/?room=${code}`);
  await waitFor(guest, () => window.__tactical.game?.match.turn === 2 && window.__tactical.game.match.phase === 'planning', 'guest to rejoin at turn 2', 60000);
  const [h2, g2] = [await summary(page), await summary(guest)];
  if (h2.soldiers !== g2.soldiers) fail('rejoined guest world differs from host');
  for (const p of [page, guest]) await p.getByRole('button', { name: 'GO ▶' }).tap();
  await waitFor(page, () => window.__tactical.game.match.turn === 3, 'host turn 3', 30000);
  await waitFor(guest, () => window.__tactical.game.match.turn === 3, 'guest turn 3', 30000);
  await page.waitForTimeout(1000);
  const [h3, g3] = [await summary(page), await summary(guest)];
  if (h3.soldiers !== g3.soldiers) fail('worlds diverged after rejoin');
  if (h3.msg || g3.msg) fail('a net error message is showing after rejoin');
  // The HOST reloads (no room link this time): it restores the saved match, rejoins as host,
  // and both carry on.
  await page.goto('http://localhost:5173/');
  await waitFor(page, () => window.__tactical.game?.match.turn === 3 && window.__tactical.game.match.localTeam === 'A', 'host to restore turn 3', 30000);
  await waitFor(page, () => !document.querySelector('#hint')?.textContent.includes('Rejoining'), 'host to reconnect', 60000);
  const [h4, g4] = [await summary(page), await summary(guest)];
  if (h4.soldiers !== g4.soldiers) fail('restored host world differs from guest');
  for (const p of [page, guest]) await p.getByRole('button', { name: 'GO ▶' }).tap();
  await waitFor(page, () => window.__tactical.game.match.turn === 4, 'host turn 4 after host reload', 30000);
  await waitFor(guest, () => window.__tactical.game.match.turn === 4, 'guest turn 4 after host reload', 30000);
  await page.waitForTimeout(1000);
  const [h5, g5] = [await summary(page), await summary(guest)];
  if (h5.soldiers !== g5.soldiers) fail('worlds diverged after host reload');

  // The guest's connection is torn down and rebuilt (what the auto-retry does after a drop):
  // the peers find each other again and the next turn plays in sync.
  await guest.evaluate(() => window.__tactical.rejoinRoom());
  await waitFor(guest, () => window.__tactical.net?.connected === true, 'guest to reconnect after rejoin', 60000);
  for (const p of [page, guest]) await p.getByRole('button', { name: 'GO ▶' }).tap();
  await waitFor(page, () => window.__tactical.game.match.turn === 5, 'host turn 5 after rejoin', 30000);
  await waitFor(guest, () => window.__tactical.game.match.turn === 5, 'guest turn 5 after rejoin', 30000);
  await page.waitForTimeout(1000);
  const [h6, g6] = [await summary(page), await summary(guest)];
  if (h6.soldiers !== g6.soldiers) fail('worlds diverged after rejoin');

  // Emote from host shows on the guest.
  await page.getByRole('button', { name: '⋯' }).tap();
  await page.getByRole('button', { name: '👍' }).tap();
  await waitFor(guest, () => document.querySelector('#hint')?.textContent.includes('Opponent: 👍'), 'emote on guest', 15000);
  await guest.close();
  return `ok: emote delivered, room ${code}, identical after turn 1, guest reloaded + rejoined, host reloaded + restored, guest rejoined the room, identical through turn 4 (${await phase(page)})`;
}
