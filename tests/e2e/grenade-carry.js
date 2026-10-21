// A frag thrown at the end of a turn: flagged ⏭ while planning, then shown with a fuse countdown next turn.
async (page) => {
  const fail = (msg) => {
    throw new Error(`grenade-carry: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Play vs AI' }).tap();
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(300);
  // Select a soldier that carries a frag; plan: stay put, wait 4 s, throw a frag 6 m ahead.
  const id = await page.evaluate(() => {
    const t = window.__tactical;
    const P = t.game.planning;
    const s = t.game.match.world.soldiers.find((x) => x.team === 'A' && x.gear.frag > 0);
    P.selectSoldier(s.id);
    P.state.drafts[s.id] = [{ x: s.x, z: s.z, move: 'walk', fire: 'hold', look: null, actions: [{ type: 'wait', t: 4 }, { type: 'grenade', kind: 'frag', x: s.x + 6, z: s.z }] }];
    P.selectWaypoint(s.id, 0);
    return s.id;
  });
  await page.locator('#bottom .row.info', { hasText: 'next turn' }).waitFor({ timeout: 2000 }).catch(() => {});
  const info = await page.locator('#bottom .row.info').innerText();
  if (!/💣 goes off 6\.7s\s+⏭ next turn/.test(info)) fail(`no late-grenade warning: "${info}"`);

  await page.evaluate(() => (window.__tactical.ui.speed = 4));
  await page.getByRole('button', { name: 'GO ▶' }).tap();
  for (let k = 0; k < 60 && (await page.evaluate(() => window.__tactical.game.match.phase)) === 'simulating'; k++) await page.waitForTimeout(100);
  const st = await page.evaluate((sid) => {
    const t = window.__tactical;
    const f = t.game.recorder.frames[t.game.cursor];
    return { phase: t.game.match.phase, grenades: f.grenades.length, alive: t.game.match.world.soldiers.find((s) => s.id === sid).alive };
  }, id);
  if (st.phase !== 'planning') fail(`expected planning, got ${JSON.stringify(st)}`);
  if (st.grenades !== 1) fail(`frag should still be live at turn end: ${JSON.stringify(st)}`);
  await page.locator('.label.danger').first().waitFor({ timeout: 2000 }).catch(() => {});
  const label = await page.locator('.label.danger').first().innerText().catch(() => '');
  if (!/^💣 1\.\ds$/.test(label)) fail(`no fuse countdown on the live frag: "${label}"`);
  return `ok: late frag flagged, countdown "${label}" shown while planning`;
}
