// Fire synthetic events into the FX view and screenshot them (/tmp/tactical-shots/fx-*.png).
async (page) => {
  await page.goto('http://localhost:5173/?capture');
  await page.getByRole('button', { name: /Play vs AI/ }).tap();
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const t = window.__tactical;
    t.rig.glideTo({ x: 0, z: 0, distance: 14 }, { instant: true });
  });
  const fire = (events) => page.evaluate((ev) => window.__tactical.game.fx.play({ events: ev }), events);
  await fire([
    { type: 'shot', from: 0, weapon: 'rifle', hit: false, x: -4, y: 1.45, z: 2, tx: 3, ty: 1, tz: -1 },
    { type: 'shot', from: 1, weapon: 'lmg', hit: true, x: -4, y: 1.45, z: 3, tx: 2, ty: 1.2, tz: 3 },
  ]);
  await page.waitForTimeout(60);
  await page.screenshot({ path: '/tmp/tactical-shots/fx-shot.png' });
  await fire([{ type: 'explosion', kind: 'frag', x: 1, y: 0.2, z: 0, radius: 4 }]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/tactical-shots/fx-frag.png' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/tactical-shots/fx-frag-late.png' });
  await page.evaluate(() => {
    const g = window.__tactical.game;
    const f = g.recorder.frames[g.cursor];
    f.smokes = [{ x: -3, z: -2, r: 2.5 }];
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/tactical-shots/fx-smoke.png' });
  return 'fx shots saved';
}
