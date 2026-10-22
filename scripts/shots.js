// Visual check: screenshots of the menu, planning view and a mid-turn frame (playwright-cli run-code).
// Saves to $SHOTS_DIR (default /tmp) as menu.png, plan.png, action.png.
async (page) => {
  const dir = '/tmp/tactical-shots';
  await page.goto('http://localhost:5173/?capture');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/menu.png` });
  await page.getByRole('button', { name: /Play vs AI/ }).tap();
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  await page.waitForTimeout(800);
  await page.evaluate(() => (window.__tactical.ui.showCones = true));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/plan.png` });
  await page.evaluate(() => {
    const t = window.__tactical;
    const s = t.game.match.world.soldiers.find((x) => x.team === 'A');
    t.rig.glideTo({ x: s.x + 2, z: s.z, distance: 9 }, { instant: true });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/close.png` });
  await page.evaluate(() => window.__tactical.rig.reset({ instant: true }));
  await page.getByRole('button', { name: /GO/ }).first().tap();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/action.png` });
  return 'shots saved';
}
