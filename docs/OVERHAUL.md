# Visual overhaul — overnight plan (2026-10-22)

Goal: make the game look and feel good: textures, better models, props, lighting, FX,
vision cones, cameras, menu and animations. Gameplay and determinism must not change.

**Rules for every step**
- Render-only changes: nothing in `src/sim/` changes behaviour (determinism + fairness tests guard this).
- Assets are generated in code (canvas textures, Three.js geometry): no downloads, small bundle, works offline.
- Phone first: keep draw calls low (instancing, merged geometry), DPR cap, a "Graphics: High/Low" setting.
- Gate each commit on `npm run check` and `npm run e2e`; look at `scripts/shots.js` screenshots
  (menu / planning / mid-turn) before committing.
- One commit per checked item (or small group). Tick the box here in the same commit.

## Phase 1 — Vision cones (biggest readability win)
- [x] Cones are clipped by walls and closed doors (2D visibility polygon from the map grid, render-side)
- [x] Soft gradient fill fading with distance + bright edge line; no darker overlap where cones stack
- [x] Fog of war: unseen floor is darkened for the viewing team (fog texture from the team's vision polygons)
- [x] Selected soldier's cone highlighted; cone animates (sweeps) when heading changes

## Phase 2 — Cameras
- [x] Smoothed camera: pan/zoom/rotate/focus ease toward targets instead of jumping
- [x] Better framing: start view shows the squad *and* the map (no empty void), clamp to map bounds
- [x] Playback director: during the turn, camera gently follows the action (firefights / selected soldier), off by user pan
- [x] Animated focus on chip double-tap, hotseat handoff and follow cam (glides; gestures stay 1:1)

## Phase 3 — Environment art
- [x] Renderer: sRGB + ACES tone mapping, soft shadows, warm key / cool fill lighting, subtle vignette
- [x] Procedural textures: concrete floor with tile variation, plaster/brick walls, wall caps, outside ground
- [x] Cover as real props: crates, sandbags, barrels, concrete barriers (deterministic choice by cell)
- [x] Doors with frames and hinged swing animation; breached doors leave debris
- [x] Baked ambient occlusion: floor darkens along wall bases; decals (stains, cracks, markings)
- [x] Per-map theme (Killhouse / Warehouse / Streets / Embassy palettes + props)

## Phase 4 — Soldiers
- [x] Rounded models: capsule limbs with elbows/knees, gloves, boots, visor, team armband/stripe
- [x] Animation: idle breathing, arm swing walk, run cycle, aim pose when firing, recoil kick, reload
- [x] Deaths fall away from the shot direction (hit puff: Phase 5)
- [x] Selection ring pulse, contact shadow blob under each soldier

## Phase 5 — FX
- [x] Muzzle flash with short point light; glowing tracers; shell casings
- [x] Bullet impacts: sparks on walls, dust on cover; hit flash on soldiers
- [x] Explosions: fireball + shockwave ring + debris + scorch decal; smoke as soft billboard particles
- [x] Flashbang: white bloom; screen shake on nearby blasts

## Phase 6 — Menu & UI animation
- [x] Main menu over a live animated 3D backdrop (slow orbit around a map with AI soldiers)
- [x] Restyled title/logo, card and buttons (press/hover animation, entrance transitions)
- [x] Turn banners ("TURN 3 · EXECUTE"), animated toasts, smoother overlay fades
- [x] Game-over screen with per-soldier stats (kills, damage, shots)
- [x] Graphics quality setting (High/Low) persisted; Low disables shadows/post/particles

## Phase 7 — Wrap-up
- [x] Performance pass (draw calls, frame time on a throttled CPU), README screenshots, roadmap status
