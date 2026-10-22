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
  await page.getByRole('button', { name: /GO/ }).first().tap();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/action.png` });
  return 'shots saved';
}
