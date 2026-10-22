// Hotseat on one device: Blue plans, hands off, Red plans its own squad; plus the planning clock.
async (page) => {
  const fail = (msg) => {
    throw new Error(`hotseat: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: /Hotseat/ }).tap();
  if ((await page.locator('.squad').count()) !== 2) fail('setup should show both squads');
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(200);
  const st = () =>
    page.evaluate(() => {
      const g = window.__tactical.game;
      const P = g.planning.state;
      const sel = g.match.world.soldiers.find((s) => s.id === P.selectedId);
      return { phase: g.match.phase, team: P.team, selTeam: sel?.team, viewer: g.match.viewerTeam, wps: P.drafts?.[P.selectedId]?.length ?? 0 };
    });
  // Tap the ground 3 m from the selected soldier, toward the middle of the map (clear of the squad).
  const tapNearSelected = async () => {
    const at = await page.evaluate(() => {
      const t = window.__tactical;
      const g = t.game;
      const sel = g.match.world.soldiers.find((x) => x.id === g.planning.state.selectedId);
      const v = t.view.camera.position.clone().set(sel.x - Math.sign(sel.x) * 3, 0, sel.z).project(t.view.camera);
      const r = document.querySelector('#app').getBoundingClientRect();
      return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
    });
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(100);
  };
  let s = await st();
  if (s.team !== 'A' || s.selTeam !== 'A' || s.viewer !== 'A') fail(`Blue planning state wrong ${JSON.stringify(s)}`);
  await tapNearSelected();
  if ((await st()).wps !== 1) fail('Blue waypoint not added');
  await page.getByRole('button', { name: 'GO ▶' }).tap();
  await page.waitForTimeout(100);
  if (!(await page.locator('#overlay').innerText()).includes("Red's turn")) fail('no handoff screen');
  await page.getByRole('button', { name: 'Start planning' }).tap();
  await page.waitForTimeout(100);
  s = await st();
  if (s.phase !== 'planning' || s.team !== 'B' || s.selTeam !== 'B' || s.viewer !== 'B') fail(`Red planning state wrong ${JSON.stringify(s)}`);
  const chips = await page.locator('.chip.team-B').count();
  if (chips !== 4) fail(`expected Red's 4 chips, got ${chips}`);
  const cam = await page.evaluate(() => ({ ...window.__tactical.rig.state }));
  if (!(cam.x > 5) || Math.abs(cam.yaw - Math.PI) > 1e-6) fail(`camera not on Red's side: ${JSON.stringify(cam)}`);
  await tapNearSelected();
  s = await st();
  if (s.wps !== 1) fail(`Red waypoint not added (${s.wps})`);

  // Planning clock: with a 1 s limit, planning auto-confirms.
  await page.evaluate(() => (window.__tactical.ui.planTimer = 1));
  await page.getByRole('button', { name: 'GO ▶' }).tap();
  // Poll (not a fixed sleep) so a busy machine doesn't fail the test; the 1 s clock leaves time to see 'planning'.
  await page.waitForTimeout(4500);
  for (let k = 0; k < 100 && (s = await st()).phase === 'simulating'; k++) await page.waitForTimeout(100);
  if (s.phase !== 'planning' || s.team !== 'A') fail(`turn 2 should start with Blue planning, got ${JSON.stringify(s)}`);
  await page.waitForTimeout(1600);
  if ((await st()).phase !== 'handoff') fail('planning clock did not auto-confirm Blue');
  return 'ok: Blue → handoff → Red planning with own squad and fog; planning clock auto-confirms';
}
