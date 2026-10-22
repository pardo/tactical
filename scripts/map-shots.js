// Spectator screenshot of every built-in map (AI vs AI setup) into /tmp/tactical-shots/map-<n>.png.
async (page) => {
  await page.goto('http://localhost:5173/?capture');
  const names = [];
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /Watch AI vs AI/ }).click();
    for (let k = 0; k < i; k++) await page.getByRole('button', { name: /🗺/ }).click();
    await page.getByRole('button', { name: 'Deploy ▶' }).click();
    await page.evaluate(() => (window.__tactical.ui.paused = true));
    await page.waitForTimeout(1500);
    names.push(await page.evaluate(() => window.__tactical.game.match.map.name));
    await page.screenshot({ path: `/tmp/tactical-shots/map-${i}.png` });
    await page.getByRole('button', { name: '✕' }).click();
    await page.getByRole('button', { name: 'Quit' }).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  return names.join(', ');
}
