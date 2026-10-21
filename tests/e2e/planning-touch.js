// Touch planning flow: tap to add waypoint, edit via panel, grenade pick, drag, GO.
// Run with: npm run e2e (needs the dev server and playwright-cli).
async (page) => {
  const fail = (msg) => {
    throw new Error(`planning-touch: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Play vs AI' }).tap();
  // Squad screen: tap slot 2 (rifleman) once → next legal role (MG and sniper are capped, so breacher).
  await page.locator('.slot').nth(1).tap();
  const slot = await page.locator('.slot').nth(1).innerText();
  if (!/BR/.test(slot)) fail(`role cycle gave "${slot}"`);
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(300);
  const st = () =>
    page.evaluate(() => {
      const g = window.__tactical.game;
      const P = g.planning.state;
      const own = g.match.world.soldiers.filter((s) => s.team === 'B');
      return {
        phase: g.match.phase,
        sel: P.selectedId,
        wp: P.wpIndex,
        pick: P.pickMode,
        wps: structuredClone(P.drafts?.[P.selectedId] ?? []),
        hiddenEnemies: own.filter((s) => !g.match.world.soldiers.find((a) => a.team === 'A' && a.visible.includes(s.id))).length,
      };
    });

  // Turn in place: soldier panel → Face… → tap the map. No waypoint needed.
  await page.getByRole('button', { name: '➜ Face…' }).tap();
  await page.touchscreen.tap(200, 200);
  await page.waitForTimeout(100);
  let s = await st();
  if (s.wps.length !== 1 || s.wps[0].actions[0]?.type !== 'face') fail(`face in place: ${JSON.stringify(s.wps)}`);
  await page.getByRole('button', { name: '🗑 Clear plan' }).tap();

  await page.touchscreen.tap(140, 330);
  await page.waitForTimeout(100);
  s = await st();
  if (s.wps.length !== 1) fail(`expected 1 waypoint after tap, got ${s.wps.length}`);
  // The waypoint's number and arrival time are shown on the map.
  await page.locator('.label', { hasText: /^1 · \d+\.\ds/ }).first().waitFor({ timeout: 2000 }).catch(() => {});
  const wpLabel = await page.locator('.labels .label').first().innerText().catch(() => '');
  if (!/^1 · \d+\.\ds/.test(wpLabel)) fail(`no waypoint ETA label: "${wpLabel}"`);

  await page.getByRole('button', { name: '🏃 Run' }).tap();
  // Phones have no tooltips: tapping a control explains it in the panel.
  // (The panel re-renders on the next animation frame, so wait for it.)
  await page.locator('#bottom .row.explain', { hasText: 'Run:' }).waitFor({ timeout: 2000 }).catch(() => {});
  const explain = await page.locator('#bottom .row.explain').innerText();
  if (!/^🏃 Run: .*loud/.test(explain)) fail(`no explanation after tapping Run: "${explain}"`);
  await page.getByRole('button', { name: '▼ Crouch' }).tap();
  await page.getByRole('button', { name: '⏱ +1s' }).tap();
  await page.getByRole('button', { name: /Flash/ }).tap();
  await page.touchscreen.tap(200, 300);
  await page.waitForTimeout(100);
  s = await st();
  const types = s.wps[0].actions.map((a) => a.type).join(',');
  if (s.wps[0].actions[2]?.kind !== 'flash') fail('grenade kind not flash');
  if (s.wps[0].move !== 'run' || types !== 'stance,wait,grenade') fail(`bad waypoint edit: ${JSON.stringify(s.wps[0])}`);
  // Selecting the waypoint again shows its plain-language summary.
  await page.evaluate(() => window.__tactical.game.planning.deselectWaypoint());
  await page.evaluate(() => window.__tactical.game.planning.selectWaypoint(window.__tactical.game.planning.state.selectedId, 0));
  await page.locator('#bottom .row.explain', { hasText: '📋' }).waitFor({ timeout: 2000 }).catch(() => {});
  const summary = await page.locator('#bottom .row.explain').innerText();
  if (summary !== '📋 Run here, firing at will, then crouch → wait 1s → throw a flashbang.') fail(`summary: "${summary}"`);
  const panel = await page.locator('#bottom .panel').boundingBox();
  const vh = page.viewportSize().height;
  if (panel.y + panel.height > vh + 1 || panel.height > vh * 0.5) fail(`waypoint panel too tall: ${JSON.stringify(panel)} of ${vh}`);


  // Drag the waypoint with a finger: project it to screen, then drag 40px.
  const at = await page.evaluate(() => {
    const t = window.__tactical;
    const w = t.game.planning.state.drafts[t.game.planning.state.selectedId][0];
    const THREEv = t.view.camera.position.clone().set(w.x, 0.07, w.z).project(t.view.camera);
    const r = document.querySelector('#app').getBoundingClientRect();
    return { x: ((THREEv.x + 1) / 2) * r.width, y: ((1 - THREEv.y) / 2) * r.height };
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7 }] });
  await touch('touchStart', at.x, at.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', at.x + i * 5, at.y);
  await touch('touchEnd');
  await page.waitForTimeout(100);
  const after = await st();
  const moved = Math.hypot(after.wps[0].x - s.wps[0].x, after.wps[0].z - s.wps[0].z);
  if (moved < 0.3) fail(`drag did not move the waypoint (moved ${moved.toFixed(2)} m)`);

  if (after.hiddenEnemies > 0) {
    const shown = await page.evaluate(() => window.__tactical.view.scene.children.length);
    if (!shown) fail('scene empty');
  }

  // Go code (after the drag: its release row makes the bottom area taller): the waypoint waits for Alpha; the release button appears above the squad and toggles.
  await page.getByRole('button', { name: '⏸ Go code' }).tap();
  await page.getByRole('button', { name: '⏸ Alpha waits' }).waitFor({ timeout: 2000 });
  await page.getByRole('button', { name: '⏸ Alpha waits' }).tap();
  await page.getByRole('button', { name: '▶ Alpha goes' }).waitFor({ timeout: 2000 });
  const go = await page.evaluate(() => window.__tactical.game.planning.state.drafts.go);
  if (JSON.stringify(go) !== '["A"]') fail(`go codes ${JSON.stringify(go)}`);
  const bar = await page.locator('#bottom .bar').boundingBox();
  if (bar.y + bar.height > vh + 1) fail(`bar with go codes overflows: ${JSON.stringify(bar)}`);

  await page.getByRole('button', { name: 'GO ▶' }).tap();
  await page.waitForTimeout(200);
  if ((await st()).phase !== 'simulating') fail('GO did not start the turn');
  await page.waitForTimeout(5600);
  s = await st();
  if (s.phase !== 'planning' && s.phase !== 'over') fail(`expected next planning phase, got ${s.phase}`);
  return `ok: waypoint moved ${moved.toFixed(2)} m by drag, turn 2 reached`;
}
