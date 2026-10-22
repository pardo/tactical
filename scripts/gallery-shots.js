// Screenshot every role model up close (dev-only gallery.html) into /tmp/tactical-shots/model-<role>.png.
async (page) => {
  const roles = ['rifleman', 'breacher', 'lmg', 'sniper', 'demolition'];
  for (const role of roles) {
    await page.goto(`http://localhost:5173/gallery.html?role=${role}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `/tmp/tactical-shots/model-${role}.png` });
  }
  return `saved ${roles.length} model shots`;
}
