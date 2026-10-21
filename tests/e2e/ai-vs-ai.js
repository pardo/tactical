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

  // Save the replay, load it back from the menu, and check it ends the same way.
  const winner = await page.evaluate(() => window.__tactical.game.match.world.winner);
  // Capture the saved file's contents in the page (the CLI can't drive native file pickers).
  await page.evaluate(() => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      blob.text().then((t) => (window.__savedReplay = t));
      return orig(blob);
    };
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '💾 Save replay' }).tap()]);
  if (!/^tactical-warehouse-.*\.json$/.test(download.suggestedFilename())) fail(`file name ${download.suggestedFilename()}`);
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '⏮ Rewatch match' }).tap();
  await page.waitForTimeout(300);
  const rewatchCursor = await page.evaluate(() => window.__tactical.game.cursor);
  await page.getByRole('button', { name: '✕' }).tap(); // match is over: no confirmation
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__tactical.loadReplayText(window.__savedReplay));
  await page.waitForTimeout(500);
  const loaded = await page.evaluate(() => {
    const g = window.__tactical.game;
    return { mode: g?.mode, winner: g?.match.world.winner, frames: g?.recorder.frames.length, map: g?.match.map.name };
  });
  if (loaded.mode !== 'replay' || loaded.winner !== winner || loaded.map !== 'Warehouse') fail(`replay mismatch ${JSON.stringify(loaded)} vs ${winner}`);
  if (rewatchCursor > 600) fail(`rewatch did not restart (cursor ${rewatchCursor})`);
  return `ok: Warehouse/zone "${card}", replay saved and reloaded (${loaded.frames} frames, same winner)`;
}
