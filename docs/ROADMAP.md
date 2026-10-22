# Tactical — Roadmap

> **Status (2026-10-22):** M0–M8 done, M9/M10 mostly done; visual overhaul done (see [OVERHAUL.md](OVERHAUL.md)). 90 unit tests + 6 browser e2e tests. Unchecked items below are what remains.

Simultaneous-turn tactical squad shooter in the browser (Door Kickers × Frozen Synapse).
Both players plan freely, confirm, then the world simulates **5 seconds**. Soldiers execute
orders with a degree of autonomy (fire on sight, hold angle, take cover, throw grenades).

**Stack:** Vite · Three.js · Rapier 3D (deterministic build) · Trystero (P2P WebRTC) · vanilla JS (ES modules, JSDoc types)

---

## 0. Guiding principles

1. **The simulation is pure and deterministic.** `sim/` has zero imports from Three.js, DOM, or networking.
   Same `(state, planA, planB, seed)` → same result on every machine. Everything else is a view or a transport.
2. **Fixed timestep.** Sim runs at 60 ticks/s → one turn = 300 ticks. Rendering interpolates; it never drives logic.
3. **No `Math.random()`, no `Date.now()`, no iteration over unordered collections in the sim.** Seeded PRNG (mulberry32/xoshiro), sorted entity IDs.
4. **Data-driven.** Roles, weapons, maps are JSON/JS config, not code branches.
5. **Offline first.** Hotseat (two players, one screen) works before any networking exists.
6. **Mobile & touch are first-class.** Every feature must be fully playable on a phone in portrait and landscape
   using touch only. Mouse/keyboard are extra shortcuts, never the only path. All input goes through
   `ui/gestures.js` (Pointer Events), touch targets ≥ 44 px, UI respects safe-area insets.

### Default design decisions (changeable)

| Topic | Decision |
|---|---|
| Camera | Top-down 3D with tilt/rotate/zoom (Three.js perspective, mostly overhead) |
| World | Tile grid (1 m cells) for walls/doors/cover + free continuous movement on top |
| Pathfinding | A* on grid, string-pulled to smooth paths |
| First mode | Elimination 4v4; Attack/Defend later |
| Vision | Per-soldier vision cones, team-shared fog of war |
| Turn timer | Optional planning timer (default 90 s) |
| Netcode | Lockstep: exchange plans, both peers simulate, compare state hash |
| Platforms | Desktop + mobile browsers (Chrome Android, Safari iOS) from M1 on; touch-first UI |

### Input scheme

| Action | Touch | Mouse / keyboard |
|---|---|---|
| Pan camera | 1-finger drag, or 2-finger drag | Left/middle drag, WASD / arrows |
| Zoom | Pinch | Wheel, + / − |
| Rotate | 2-finger twist | Right drag, Q / E |
| Select soldier / add waypoint | Tap | Click |
| Context (radial) menu | Long-press (haptic tick) | Long-press or right-click |
| Move waypoint / draw facing arc | Drag starting on a handle | Same |
| Confirm turn, undo, soldier switch | Bottom action bar (thumb zone) | Bar + hotkeys (Enter, Ctrl+Z, 1–4) |

---

## 1. Architecture

```
src/
  sim/                 # PURE, deterministic. No Three.js, no DOM.
    world.js           # state container, entities, tick()
    rng.js             # seeded PRNG
    physics.js         # Rapier wrapper: colliders, raycasts, grenades
    nav.js             # grid, A*, path smoothing
    vision.js          # LOS, cones, fog of war
    soldier/
      brain.js         # per-tick decision: follow plan vs react
      perception.js    # spotting, reaction timers
      combat.js        # aim, accuracy, hits, damage, suppression
      actions.js       # move, hold, cover, grenade, breach, ...
    roles.js           # role/weapon data
    turn.js            # runTurn(state, plans, seed) -> {state, events}
    hash.js            # state hash for desync detection
  plan/                # plan data model + validation (shared by UI and net)
  render/              # Three.js scene, models, FX, interpolation, replay
  ui/                  # planning tools, HUD, menus
  net/                 # Trystero rooms, messages, lockstep protocol
  maps/                # map JSON + loader
  main.js
tests/                 # determinism, nav, combat unit tests (Vitest)
```

**Turn data flow**
```
PLANNING ─► plans validated ─► both confirmed ─► runTurn() 300 ticks ─► events[] + snapshots
   ▲                                                                         │
   └──────────── REVIEW (replay / scrub the 5 s, per-soldier camera) ◄───────┘
```

**Plan format (per soldier)**
```js
{ soldierId, waypoints: [
    { pos:[x,z], speed:'walk'|'run'|'sneak', stance:'stand'|'crouch',
      fire:'onSight'|'hold'|'returnOnly',
      facing:{ type:'path'|'point'|'arc', target, arc },
      action:{ type:'wait', ticks } | { type:'grenade', target } | { type:'breach', door } | null,
      trigger:{ type:'immediate'|'atTime'|'goCode', value } }
]}
```

---

## 2. Milestones

### M0 — Foundations (repo & tooling)
- [x] git repo, `.gitignore`
- [x] Vite project, ESLint + Prettier, Vitest
- [x] Rapier (`@dimforge/rapier3d-deterministic-compat`) loads in browser and tests
- [x] Folder skeleton per §1, `npm run dev / test / build`
- [x] Seeded RNG + fixed-step loop + test harness

**Done when:** `npm run dev` shows an empty Three.js scene; `npm test` passes a determinism smoke test.

### M1 — Sandbox: map, movement, camera
- [x] Map format (ASCII grid: floor, wall, low cover, doorway, spawns) — `src/maps/killhouse.js`
- [ ] Map format extras: high cover, windows, spawn zones (with M5 doors)
- [x] Map loader → Rapier static colliders (run-merged) + instanced Three.js meshes
- [x] Camera: pan, zoom-to-point, rotate — touch (drag/pinch/twist) + mouse + keyboard
- [x] Mobile shell: no browser zoom/scroll, safe areas, DPR cap, orientation-aware FOV, fullscreen button
- [x] Gesture layer (tap / long-press / pan / pinch / twist), unit tested
- [x] Soldier entity (capsule placeholder), grid A* (deterministic ties, no corner cutting) + clearance-aware smoothing
- [x] Tap/click to select, tap to walk, long-press to run; sim runs in real time for debugging
- [x] Deterministic trig (`sim/fmath.js`); lint bans `Math.sin` & co. inside `src/sim`

**Done when:** a soldier walks around walls smoothly on a hand-made test map.

### M2 — Planning UI & turn loop (single player, no enemies)
- [x] Turn state machine: `PLANNING → SIMULATING → REVIEW → PLANNING` (`src/game/match.js`)
- [x] Waypoint drawing: tap to add, hold for a running waypoint, drag (or hold-then-drag) to move; delete from the panel
- [x] Bottom action bar: soldier chips (role, HP, waypoint count), Undo, GO — thumb reachable
- [x] Per-waypoint editor — built as a bottom-sheet panel (better for thumbs than a radial): move, fire mode, crouch/stand, face, wait, sync, grenades, breach, look-while-moving
- [x] Facing tool: "Face…" then tap the map (arrow drawn at the waypoint)
- [x] Waypoints/handles drawn with screen-space size so they stay tappable when zoomed out
- [x] Path + timeline preview: ETA label per waypoint and a marker where the soldier is at 5 s (no ghost soldier)
- [x] Simulate exactly 300 ticks, then stop mid-path; remaining plan carries over
- [x] Undo, clear plan per soldier, "hold here" (no redo)

**Done when:** you can plan 4 soldiers, press Confirm, and watch them execute 5 s, then continue planning.

### M3 — Vision & combat core (hotseat 4v4) ← **first playable**
- [x] Vision cones (FOV, range), LOS via Rapier raycasts, walls/doors/smoke block, low cover partially
- [x] Fog of war per team; last-known-position ghost markers
- [x] **Perception & reaction model**
  - spot time depends on distance, target stance/speed, inside vs outside facing arc
  - reaction time by state: holding angle ≈ 0.15 s · walking ≈ 0.4 s · running ≈ 0.8 s · +turn time if outside arc
- [x] Combat: turn-to-aim speed, hit chance (range, movement, stance, suppression, cover), damage, simultaneous deaths
- [x] Fire modes: fire at will / return fire / hold fire
- [x] Hotseat: P1 plans, handoff screen, P2 plans, simulate, both review
- [x] Win condition: elimination; 30-turn limit draw
- [x] Replay/scrub of the whole match (per-tick snapshots), speed control
- [x] Determinism tests (random orders, full AI matches, two-client lockstep)

**Done when:** two people on one PC play a full 4v4 match and holding an angle reliably beats running in.

### M4 — Roles & weapons
- [x] Role data: HP, speed, weapon, gear, reaction multipliers (`src/sim/roles.js`)
- [x] Weapons: damage, fire rate, accuracy falloff, shotgun damage falloff, magazine/reload, aim speed, suppression
- [x] Roles:
  - **Rifleman** — balanced
  - **LMG** — suppression (enemies in fire lane get accuracy & reaction penalties), slow aim, deploy when holding
  - **Sniper** — high damage, very fast reaction when holding, huge penalty moving
  - **Breacher** — shotgun, breach charges, fast door entry
  - **Demolition** — extra frags, grenade launcher, destroys low cover
  - **Medic/Support** (later) — revive downed soldier, extra ammo
- [x] Squad selection screen (tap a slot to cycle; max 1 sniper, 1 MG)
- [x] Reload logic and auto-reload when safe

### M5 — Grenades, doors, utility
- [x] Rapier rigid-body grenades: arc preview, bounce, fuse timer
- [x] Frag (damage falloff + LOS check), flashbang (blind by LOS and facing), smoke (blocks vision)
- [x] Doors: closed → open by walking through, or breach charge (stuns/wounds behind door). No locked/kick yet
- [x] Action triggers: throw at waypoint ("throw when enemy spotted" not built)
- [x] **Go-codes** — built as "Sync": hold until T seconds into the turn, for synchronised entries
- [x] Destructible low cover (frag blasts)

### M6 — Smarter autonomy
- [x] Take cover order: nearest low cover facing the threat (or facing direction), crouch
- [x] Auto-crouch when pinned by suppression
- [ ] Under fire behavior per soldier "doctrine": `hold position` / `return fire` / `seek cover`
- [x] Target priority: least turning, then closest
- [x] Teammate awareness: hold fire when a friendly is in the line of fire; callouts turn idle teammates
- [x] Suppression (pinned soldiers move slower, aim worse, react slower)

### M7 — Multiplayer (Trystero)
- [x] Lobby: create/join room by code or `?room=` link (Trystero, Nostr strategy)
- [x] Handshake: version check, map/mode/seed agreement, squad picks, side assignment
- [x] Lockstep protocol:
  1. each peer sends `commit = hash(plan)` on Confirm (prevents plan-sniffing before the opponent confirms)
  2. when both committed, reveal full plans
  3. verify hashes, run `runTurn(state, planA, planB, seed+turn)`
  4. exchange resulting state hash → mismatch = desync banner + log dump
- [x] Planning clock (45/90/120 s, host sets it online; auto-confirms when it runs out)
- [x] Disconnect/reconnect: host sends the plan history, the guest re-simulates and continues
- [x] Quick emotes (fixed list; no free-text chat)
- [x] Known limitation: both clients hold full state → fog of war is client-side (fine for friendly play; see M10)

### M8 — Content & modes
- [x] 4 maps: Killhouse, Warehouse, Embassy, Streets (point-symmetric, validated by tests)
- [x] In-browser map editor (touch painting, auto-mirrored, live validation, save/export/import, test-play)
- [x] Modes: Elimination, Hold the Zone (Attack/Defend not built)
- [ ] Asymmetric deployment: defenders get pre-placement phase

### M9 — Presentation & feel
- [x] Low-poly soldier models (procedural, no GLTF) with walk, crouch and death animation
- [x] Tracers, explosions, flash bursts, smoke clouds (no muzzle flash/decals yet)
- [x] Audio: synthesised positional gunshots/explosions/doors/reloads (no footsteps or voice barks)
- [x] Camera follow (tap a soldier while watching); no slow-mo kill cam
- [x] Full-match replay export/import (plans + seed = tiny file)
- [x] How-to-play screen (no interactive tutorial)
- [ ] UI polish, keybinds, settings, accessibility (colorblind team colors)

### M10 — Final / stretch
- [x] Single-player vs AI planner (heuristic, team-knowledge only; no sim lookahead)
- [ ] 2v2 (2 soldiers each, 4 players) and 3+ team support
- [ ] Optional authoritative server (Node running the same `sim/`) for ranked play with real hidden information
- [ ] Squad progression / loadout customization / cosmetics
- [ ] Spectator mode (late-joining peers receive plans only)
- [x] Installable PWA (manifest, offline cache)
- [x] Deploy: static build + GitHub Pages workflow (needs a GitHub repo to run)

---

## 3. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Floating-point desync between browsers | Rapier deterministic build; own trig in `sim/fmath.js` (Math.sin etc. differ per engine); state hash each turn; determinism test suite in CI |
| Rapier WASM init async/complexity | Wrap in `physics.js`; use only static colliders + raycasts + grenade bodies |
| Planning UI becomes too fiddly | Prototype UI in M2 before content; playtest early |
| AI autonomy feels random/unfair | Expose reaction numbers in debug overlay; review mode shows *why* (e.g. "spotted at 0.4 s, outside arc +0.3 s") |
| P2P NAT failures | Trystero with multiple strategies; fallback TURN server config later |
| Scope creep | Ship M3 (hotseat playable) before anything in M4+ |

---

## 4. Version map

| Version | Milestones | What you can do |
|---|---|---|
| v0.1 | M0–M2 | Plan & watch your squad move in 5 s turns |
| v0.2 | M3 | **First playable**: hotseat 4v4 with vision and gunfights |
| v0.3 | M4–M5 | Roles, grenades, doors, go-codes |
| v0.4 | M6 | Autonomous soldiers that feel smart |
| v0.5 | M7 | Online multiplayer via link |
| v0.8 | M8–M9 | Real maps, modes, art, sound |
| v1.0 | M10 subset | Bots, polish, deployed |
