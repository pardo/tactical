// Spectate a whole AI vs AI match at 4×, then rewatch from the start.
async (page) => {
  const fail = (msg) => {
    throw new Error(`ai-vs-ai: ${msg}`);
  };
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Watch AI vs AI' }).tap();
  // Setup: switch to the Warehouse map and zone mode.
  await page.getByRole('button', { name: /Killhouse/ }).tap();
  await page.getByRole('button', { name: /Elimination/ }).tap();
  const setup = await page.locator('#overlay .card').innerText();
  if (!/Warehouse/.test(setup) || !/Hold the zone/.test(setup)) fail(`setup did not change: ${setup}`);
  await page.getByRole('button', { name: 'Deploy ▶' }).tap();
  const mapName = await page.evaluate(() => window.__tactical.game.match.map.name);
  if (mapName !== 'Warehouse') fail(`playing on ${mapName}`);
  await page.evaluate(() => (window.__tactical.ui.speed = 4));
  const deadline = Date.now() + 120000;
  let phase;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    phase = await page.evaluate(() => window.__tactical.game.match.phase);
    if (phase === 'over') break;
  }
  if (phase !== 'over') fail('match did not finish in time');
  await page.waitForTimeout(300);
  const card = await page.locator('#overlay .card h2').innerText();
  if (!/wins|Draw/.test(card)) fail(`unexpected game over text "${card}"`);
  const log = await page.locator('#log').innerText();
  if (!/down/.test(log)) fail('log shows no kills');

  await page.getByRole('button', { name: '⏮ Rewatch match' }).tap();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const g = window.__tactical.game;
    return { cursor: g.cursor, frames: g.recorder.frames.length, turns: g.recorder.turns.length };
  });
  if (r.cursor > r.frames / 4) fail(`rewatch did not restart (cursor ${r.cursor})`);
  return `ok: Warehouse/zone "${card}" after ${r.turns} turns, ${r.frames} frames recorded, rewatch playing`;
}
