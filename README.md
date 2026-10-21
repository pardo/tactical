# Tactical

A simultaneous-turn tactical squad shooter for the browser (think Door Kickers × Frozen Synapse),
built touch-first for phones.

Both players plan their 4-soldier squads, press **GO**, and the plans play out at the same time
for 5 seconds. Soldiers act on their own within your orders: they spot, react, aim, shoot, take
cover and turn toward threats, so *how* you move (holding an angle vs. running in) decides fights.

## Play

- **vs AI**, **AI vs AI** (spectate, with full-match replay and an event log), **Hotseat**
  (two players, one device) and **Online** (peer-to-peer, share a room code or link).
- Maps: Killhouse, Warehouse, Embassy, Streets (all point-symmetric). Modes: Elimination, Hold the zone.
- Roles: Rifleman, Machine gunner, Sniper, Breacher, Demolition.
- Installable as an app (PWA) from the browser menu when served over https.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173 (also on your LAN for phones)
npm test         # Vitest: sim, AI, netcode, planning (headless)
npm run e2e      # browser smoke tests (needs `npm run dev` running and playwright-cli)
npm run build    # static site in dist/
```

## Architecture

- `src/sim/` deterministic simulation (fixed 60 Hz, seeded RNG, own trig, Rapier deterministic
  build). No Three.js, DOM or clock: same inputs give bit-identical results on every machine, which
  is what makes lockstep multiplayer and replays work. Lint rules enforce this.
- `src/ai/` turn planner that uses only what its team has seen.
- `src/game/` match flow (planning → simulate → …) and the frame recorder used for replay.
- `src/net/` online lockstep: plans are committed (SHA-256) then revealed, worlds are hash-checked
  every turn. Transport is Trystero (WebRTC, Nostr signalling).
- `src/render/` Three.js views driven by recorded frames; `src/ui/` touch gestures, HUD, planning.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the plan and status.
