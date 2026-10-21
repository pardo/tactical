# Tactical — Roadmap

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
- [ ] git repo, `.gitignore`
- [ ] Vite project, ESLint + Prettier, Vitest
- [ ] Rapier (`@dimforge/rapier3d-deterministic-compat`) loads in browser and tests
- [ ] Folder skeleton per §1, `npm run dev / test / build`
- [ ] Seeded RNG + fixed-step loop + test harness

**Done when:** `npm run dev` shows an empty Three.js scene; `npm test` passes a determinism smoke test.

### M1 — Sandbox: map, movement, camera
- [ ] Map format (JSON grid: floor, wall, low cover, high cover, door, window, spawn zones)
- [ ] Map loader → Rapier static colliders + Three.js meshes (simple boxes)
- [ ] Camera: pan (WASD/drag), zoom, rotate
- [ ] Soldier entity (capsule placeholder), grid A* + path smoothing
- [ ] Click to select, click to move; sim runs in real time for debugging

**Done when:** a soldier walks around walls smoothly on a hand-made test map.

### M2 — Planning UI & turn loop (single player, no enemies)
- [ ] Turn state machine: `PLANNING → SIMULATING → REVIEW → PLANNING`
- [ ] Waypoint drawing: click to add, drag to move, right-click to delete, shift for chains
- [ ] Per-waypoint radial menu: speed, stance, fire mode, facing, wait
- [ ] Facing tool: drag an arc to "hold this angle"
- [ ] Path + timeline preview (ghost soldier, time stamps along the path)
- [ ] Simulate exactly 300 ticks, then stop mid-path; remaining plan carries over
- [ ] Undo/redo, clear plan per soldier

**Done when:** you can plan 4 soldiers, press Confirm, and watch them execute 5 s, then continue planning.

### M3 — Vision & combat core (hotseat 4v4) ← **first playable**
- [ ] Vision cones (FOV, range), LOS via Rapier raycasts, high cover blocks, low cover blocks when crouched
- [ ] Fog of war per team; last-known-position markers
- [ ] **Perception & reaction model**
  - spot time depends on distance, target stance/speed, inside vs outside facing arc
  - reaction time by state: holding angle ≈ 0.15 s · walking ≈ 0.4 s · running ≈ 0.8 s · +turn time if outside arc
- [ ] Combat: turn-to-aim speed, accuracy cone (stance, movement, suppression, range), hitscan raycast, damage, death
- [ ] Fire modes: on sight / hold fire / return fire only
- [ ] Hotseat: P1 plans (screen hidden), P2 plans, simulate, both review
- [ ] Win condition: elimination; turn limit draw
- [ ] Replay/scrub of the last turn (store per-tick snapshots)
- [ ] Determinism test: same inputs → identical state hash over 50 random turns

**Done when:** two people on one PC play a full 4v4 match and holding an angle reliably beats running in.

### M4 — Roles & weapons
- [ ] Role data: HP, speed, weapon, utility, perk
- [ ] Weapons: damage, RoF, spread, range falloff, magazine/reload, aim time
- [ ] Roles:
  - **Rifleman** — balanced
  - **LMG** — suppression (enemies in fire lane get accuracy & reaction penalties), slow aim, deploy when holding
  - **Sniper** — high damage, very fast reaction when holding, huge penalty moving
  - **Breacher** — shotgun, breach charges, fast door entry
  - **Demolition** — extra frags, grenade launcher, destroys low cover
  - **Medic/Support** (later) — revive downed soldier, extra ammo
- [ ] Squad selection screen (choose 4 from roster, max 1 sniper etc.)
- [ ] Reload logic and auto-reload when safe

### M5 — Grenades, doors, utility
- [ ] Rapier rigid-body grenades: arc preview, bounce, fuse timer
- [ ] Frag (damage falloff + LOS check), flashbang (blind/deafen = huge reaction penalty), smoke (blocks vision volume)
- [ ] Doors: open/closed/locked; open, kick, breach charge (stuns behind door)
- [ ] Action triggers: "throw at waypoint", "throw when enemy spotted in area"
- [ ] **Go-codes**: soldiers wait at waypoint until code A/B/C fires (planner sets when it fires in the 5 s window) — synchronized room entries
- [ ] Destructible low cover (demolition)

### M6 — Smarter autonomy
- [ ] Take cover order: find nearest valid cover point relative to known threats
- [ ] Auto-crouch behind low cover when holding
- [ ] Under fire behavior per soldier "doctrine": `hold position` / `return fire` / `seek cover`
- [ ] Target priority: closest / most dangerous / the one in my arc
- [ ] Teammate awareness: don't shoot through friendlies, call out spotted enemies (shared vision delay)
- [ ] Suppression state machine (pinned soldiers move slower, can't aim well)

### M7 — Multiplayer (Trystero)
- [ ] Lobby: create/join room by code (Trystero `joinRoom`, torrent or nostr strategy)
- [ ] Handshake: version check, map/seed agreement, squad picks, side assignment
- [ ] Lockstep protocol:
  1. each peer sends `commit = hash(plan)` on Confirm (prevents plan-sniffing before the opponent confirms)
  2. when both committed, reveal full plans
  3. verify hashes, run `runTurn(state, planA, planB, seed+turn)`
  4. exchange resulting state hash → mismatch = desync banner + log dump
- [ ] Planning timer synced (host-authoritative clock)
- [ ] Disconnect/reconnect: rejoin with full state snapshot from peer
- [ ] Chat + ping/emotes
- [ ] Known limitation: both clients hold full state → fog of war is client-side (fine for friendly play; see M10)

### M8 — Content & modes
- [ ] 4–6 maps (house, warehouse, embassy, street, killhouse)
- [ ] In-browser map editor (paint tiles, place doors/cover/spawns, export JSON)
- [ ] Modes: Elimination, Attack/Defend (bomb/hostage/VIP), Hold the Zone
- [ ] Asymmetric deployment: defenders get pre-placement phase

### M9 — Presentation & feel
- [ ] Low-poly soldier models + animations (idle, walk, run, crouch, aim, fire, die) — GLTF
- [ ] Muzzle flash, tracers, impact decals, grenade explosions, smoke particles
- [ ] Audio: spatial gunshots, footsteps, voice barks ("Contact!", "Reloading!", "Frag out!")
- [ ] Replay camera follow + slow-mo kill cam
- [ ] Full-match replay export/import (plans + seed = tiny file)
- [ ] Tutorial / training missions vs bots
- [ ] UI polish, keybinds, settings, accessibility (colorblind team colors)

### M10 — Final / stretch
- [ ] Single-player vs AI planner (bot generates plans using the same sim for lookahead)
- [ ] 2v2 (2 soldiers each, 4 players) and 3+ team support
- [ ] Optional authoritative server (Node running the same `sim/`) for ranked play with real hidden information
- [ ] Squad progression / loadout customization / cosmetics
- [ ] Spectator mode (late-joining peers receive plans only)
- [ ] Mobile/touch planning UI
- [ ] Deploy: static hosting (GitHub Pages / Netlify / Cloudflare Pages)

---

## 3. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Floating-point desync between browsers | Rapier deterministic build; keep own sim math simple; state hash each turn; determinism test suite in CI |
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
