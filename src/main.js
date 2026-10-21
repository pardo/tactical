import './style.css';
import { initPhysics } from './sim/physics.js';
import { TICK_RATE, TURN_TICKS, DT } from './sim/constants.js';
import { makeWaypoint } from './sim/plan.js';
import { createMatch, TEAM_NAMES } from './game/match.js';
import { ROLES, WEAPONS, DEFAULT_SQUAD, cycleRole } from './sim/roles.js';
import { createRecorder } from './game/recorder.js';
import { MAPS, MAP_IDS, DEFAULT_MAP } from './maps/index.js';
import { MODES, MODE_IDS } from './sim/objective.js';
import { createScene } from './render/scene.js';
import { createMapView } from './render/mapView.js';
import { createSoldierView } from './render/soldierView.js';
import { createPlanView } from './render/planView.js';
import { createFxView } from './render/fxView.js';
import { createCameraRig } from './render/cameraRig.js';
import { createTapMarker } from './render/marker.js';
import { attachGestures } from './ui/gestures.js';
import { createKeyboard } from './ui/keyboard.js';
import { createHud, overlays, actionLabel } from './ui/hud.js';
import { createLabels } from './ui/labels.js';
import { createPlanning } from './ui/planning.js';
import { startLoop } from './loop.js';
import { createAudio } from './render/audio.js';
import { exportReplay, validateReplay, fastForward } from './game/replay.js';
import { hashWorld } from './sim/world.js';
import { createSession } from './net/session.js';
import { createTrysteroTransport, randomRoomCode } from './net/trystero.js';

await initPhysics();

const SPEEDS = [0.5, 1, 2, 4];
const PICK_HINTS = {
  face: 'Tap the map: where to face',
  look: 'Tap the map: what to watch while moving',
  'grenade:frag': 'Tap the map: frag target (max 14 m)',
  'grenade:flash': 'Tap the map: flashbang target (max 14 m)',
  'grenade:smoke': 'Tap the map: smoke target (max 14 m)',
  breach: 'Tap the door to blow (stand next to it)',
};
const LOG_LINES = 10;

const app = document.getElementById('app');
let view;
try {
  view = createScene(app);
} catch (err) {
  document.getElementById('ui').innerHTML =
    `<div id="overlay"><div class="card"><h2>3D graphics unavailable</h2><p>${String(err.message)}</p>` +
    '<p class="small">This game needs WebGL 2. Try another browser, or enable hardware acceleration.</p></div></div>';
  throw err;
}
const marker = createTapMarker(view.scene);
const keyboard = createKeyboard();
const audio = createAudio();
// Browsers only start audio from a user gesture.
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
const labels = createLabels(document.getElementById('ui'));
const hud = createHud(document.getElementById('ui'), onAction);
let viewW = 1;
let viewH = 1;
let rig = null;

const ui = {
  paused: false,
  speed: 1,
  showCones: false,
  showPlans: true,
  logOpen: true,
  auto: true,
  squads: { A: [...DEFAULT_SQUAD], B: [...DEFAULT_SQUAD] },
  mapId: DEFAULT_MAP,
  gameMode: 'elimination',
};

const settings = () => ({
  mapName: MAPS[ui.mapId].name,
  modeName: MODES[ui.gameMode].label,
  modeHelp: MODES[ui.gameMode].help,
});
const cycle = (list, v) => list[(list.indexOf(v) + 1) % list.length];

function squadOverlay(mode) {
  const humanTeams = mode === 'hotseat' ? ['A', 'B'] : mode === 'vsAI' ? ['A'] : [];
  const teams = humanTeams.map((team) => ({
    team,
    name: TEAM_NAMES[team],
    squad: ui.squads[team].map((r) => ({ role: r, label: ROLES[r].label, short: ROLES[r].short })),
  }));
  return overlays.squad(teams, mode, settings());
}

/** Everything belonging to the current match. */
let g = null;

/** Online session state while in a room. */
let net = null;

function leaveRoom() {
  net?.session.leave();
  net = null;
  if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
}

function lobbyOverlay() {
  const team = net.isHost ? 'A' : 'B';
  return overlays.lobby({
    code: net.code,
    isHost: net.isHost,
    connected: net.connected,
    ready: net.ready,
    team,
    teamName: TEAM_NAMES[team],
    squad: ui.squads[team].map((r) => ({ label: ROLES[r].label, short: ROLES[r].short })),
    settings: settings(),
  });
}

function enterRoom(code, isHost) {
  leaveRoom();
  let transport;
  try {
    transport = createTrysteroTransport(code);
  } catch (err) {
    return hud.overlay(overlays.online(`Could not open room: ${err.message}`));
  }
  net = { code, isHost, connected: false, ready: false, sentState: new Set(), opponentReady: false, session: null };
  net.session = createSession({ transport, isHost, onEvent: onNetEvent });
  hud.overlay(lobbyOverlay());
}

function onNetEvent(e) {
  if (!net) return;
  switch (e.type) {
    case 'peerJoined':
      net.connected = true;
      if (!g) hud.overlay(lobbyOverlay());
      break;
    case 'peerLeft':
      net.connected = false;
      if (g) {
        ui.paused = true;
        g.netMessage = overlays.message('Opponent disconnected', 'The other player left the room.');
      } else hud.overlay(lobbyOverlay());
      break;
    case 'versionMismatch':
      hud.overlay(overlays.message('Version mismatch', 'Both players need the same game version. Reload and try again.'));
      break;
    case 'start':
      startMatch('online', {
        seed: e.seed,
        squads: e.squads,
        localTeam: e.localTeam,
        mapId: MAPS[e.map] ? e.map : ui.mapId,
        gameMode: MODES[e.mode] ? e.mode : ui.gameMode,
      });
      break;
    case 'remoteCommitted':
      net.opponentReady = true;
      break;
    case 'plans':
      g?.match.setRemotePlans(e.team, e.plans);
      net.opponentReady = false;
      if (g?.match.phase === 'simulating') onPhase();
      break;
    case 'desync':
      g?.log.push({ i: g.cursor, team: null, cls: 'kill', text: `⚠ DESYNC on turn ${e.turn} (${e.local} vs ${e.remote})` });
      if (g) g.netMessage = overlays.message('Desync', `The two games diverged on turn ${e.turn}. Please report this.`);
      break;
    case 'cheat':
      if (g) g.netMessage = overlays.message('Invalid plan', "The opponent's plan did not match what they committed to.");
      break;
  }
}

function startMatch(mode, opts = {}) {
  endMatch();
  const seed = opts.seed ?? (Math.random() * 2 ** 31) >>> 0;
  const squads =
    opts.squads ?? (mode === 'aiVsAi' ? {} : mode === 'vsAI' ? { A: ui.squads.A } : { A: ui.squads.A, B: ui.squads.B });
  const mapId = opts.mapId ?? ui.mapId;
  const gameMode = opts.gameMode ?? ui.gameMode;
  const match = createMatch({ mode, mapDef: MAPS[mapId], mapId, seed, squads, localTeam: opts.localTeam, gameMode });
  const { map } = match;
  const half = Math.max(map.width, map.height) / 2;
  view.setShadowBounds(half + 2);
  // Start framed on your own squad (spectators: whole map), looking toward the enemy.
  const own = match.viewerTeam;
  const mine = own ? match.world.soldiers.filter((s) => s.team === own) : [];
  const focus = mine.length
    ? { x: mine.reduce((a, s) => a + s.x, 0) / mine.length / 2, z: mine.reduce((a, s) => a + s.z, 0) / mine.length / 2 }
    : { x: 0, z: 0 };
  rig = createCameraRig(view.camera, {
    bounds: half,
    distance: map.width * (mine.length ? 0.65 : 0.8),
    focus,
    yaw: own === 'B' ? Math.PI : 0,
  });
  rig.setViewport(viewW, viewH);

  g = {
    mode,
    seed,
    match,
    recorder: createRecorder(match.world),
    mapView: createMapView(view.scene, map, match.world.objective),
    soldiers: createSoldierView(view.scene, match.labels),
    plans: createPlanView(view.scene),
    fx: createFxView(view.scene),
    planning: createPlanning(map),
    cursor: 0,
    budget: 0,
    turnEndWait: 0,
    log: [],
    overShown: false,
    watchSelected: null,
    netMessage: null,
    confirm: null,
  };
  ui.paused = false;
  ui.speed = 1;
  ui.showCones = mode === 'aiVsAi';
  // The log covers a lot of a phone screen; open it by default only when spectating.
  ui.logOpen = mode === 'aiVsAi' || !matchMedia('(max-width: 700px)').matches;
  hud.overlay(null);
  if (opts.replay) {
    // Re-simulate the whole file now, then play it back from the start.
    fastForward(match, opts.replay.turns, {
      onTurn: () => onPhase(),
      onTick: (w) => {
        g.recorder.record(w);
        logFrame(frames().length - 1, frames()[frames().length - 1]);
      },
    });
    g.cursor = 0;
    return;
  }
  nextTurn();
}

function downloadReplay() {
  const data = exportReplay(g.match);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tactical-${data.mapId}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function pickReplayFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    loadReplayText(await file.text());
  };
  input.click();
}

function loadReplayText(text) {
  try {
    const data = validateReplay(JSON.parse(text));
    startMatch('replay', { seed: data.seed, squads: data.squads, mapId: data.mapId, gameMode: data.gameMode, replay: data });
  } catch (err) {
    hud.overlay(overlays.message('Could not load replay', err.message));
  }
}

function endMatch() {
  if (!g) return;
  view.scene.remove(g.mapView);
  g.soldiers.dispose();
  g.plans.hide();
  g.fx.clear();
  g = null;
}

const frames = () => g.recorder.frames;
const atLive = () => g.cursor >= frames().length - 1;
const editing = () => g && g.match.phase === 'planning' && atLive();
const soldierOf = (id) => g.match.world.soldiers.find((s) => s.id === id);

function nextTurn() {
  g.turnEndWait = 0;
  g.match.beginTurn();
  onPhase();
}

function onPhase() {
  const { match } = g;
  if (match.phase === 'planning') {
    g.planning.begin(match.planningTeam, match.drafts[match.planningTeam], () => match.world.soldiers);
  } else if (match.phase === 'simulating') {
    const notes = { ...match.aiNotes.A, ...match.aiNotes.B };
    g.recorder.startTurn(match.turn, match.drafts, notes);
    const frame = frames().length - 1;
    for (const [id, note] of Object.entries(notes)) {
      const s = soldierOf(Number(id));
      g.log.push({ i: frame, team: s.team, cls: 'note', text: `T${match.turn} ${match.labels[id]}: ${note}` });
    }
    ui.paused = false;
  }
}

/** Advance playback by one frame, simulating if we are at the live edge. */
function advance() {
  if (!atLive()) {
    g.cursor++;
    playFrame(frames()[g.cursor]);
    return true;
  }
  if (g.match.phase !== 'simulating') return false;
  g.match.stepSim();
  g.recorder.record(g.match.world);
  g.cursor++;
  const frame = frames()[g.cursor];
  logFrame(g.cursor, frame);
  playFrame(frame);
  return true;
}

/** Effects and sounds for a frame we are playing through (not when scrubbing). */
function playFrame(frame) {
  g.fx.play(frame);
  if (ui.speed <= 2) {
    const r = rig.state;
    audio.play(frame, { x: r.x, z: r.z, yaw: r.yaw, range: r.distance });
  }
}

function turnTime(i) {
  const t = g.recorder.turnAt(i);
  return t ? { turn: t.turn, sec: (i - t.frame) / TICK_RATE } : { turn: 0, sec: 0 };
}

function logFrame(i, frame) {
  const L = g.match.labels;
  const { turn, sec } = turnTime(i);
  const ts = `T${turn} ${sec.toFixed(1)}s`;
  const team = (id) => soldierOf(id).team;
  for (const e of frame.events) {
    if (e.type === 'engage') {
      g.log.push({ i, team: team(e.id), cls: team(e.id), text: `${ts} ${L[e.id]} sees ${L[e.targetId]} · react ${e.reaction.toFixed(2)}s (${e.why})` });
    } else if (e.type === 'damage') {
      g.log.push({ i, team: team(e.sourceId), cls: team(e.sourceId), text: `${ts} ${L[e.sourceId]} hits ${L[e.id]} −${Math.round(e.amount)}` });
    } else if (e.type === 'death') {
      g.log.push({ i, team: null, cls: 'kill', text: `${ts} ☠ ${L[e.id]} down` });
    } else if (e.type === 'throw') {
      g.log.push({ i, team: team(e.id), cls: team(e.id), text: `${ts} ${L[e.id]} throws a ${e.kind}` });
    } else if (e.type === 'blinded') {
      g.log.push({ i, team: null, cls: team(e.id), text: `${ts} ${L[e.id]} blinded ${e.duration.toFixed(1)}s` });
    } else if (e.type === 'breach') {
      g.log.push({ i, team: null, cls: 'kill', text: `${ts} 💥 ${L[e.id]} breaches a door` });
    } else if (e.type === 'reload') {
      g.log.push({ i, team: team(e.id), cls: team(e.id), text: `${ts} ${L[e.id]} reloading` });
    }
  }
}

function visibleLog() {
  const hideTeam = g.mode === 'vsAI' ? 'B' : null; // don't leak the AI's thoughts in a real match
  const out = [];
  for (let k = g.log.length - 1; k >= 0 && out.length < LOG_LINES; k--) {
    const e = g.log[k];
    if (e.i > g.cursor) continue;
    if (hideTeam && e.team === hideTeam) continue;
    out.push(e);
  }
  return out.reverse();
}

function jumpTo(i) {
  g.cursor = Math.max(0, Math.min(frames().length - 1, i));
  g.fx.clear();
}

// ---------------------------------------------------------------- input

function handleTap(x, y, long) {
  if (!g || !rig) return;
  const p = rig.groundAt(x, y);
  if (!editing()) {
    const id = g.soldiers.pick(view.camera, x, y, viewW, viewH);
    g.watchSelected = id === g.watchSelected ? null : id;
    return;
  }
  const P = g.planning;
  if (P.state.pickMode) {
    if (p && P.applyPick(p.x, p.z)) marker.show(p, 0xc28bff);
    return;
  }
  if (!long) {
    const h = g.plans.pickWaypoint(view.camera, x, y, viewW, viewH);
    if (h) {
      P.selectWaypoint(h.soldierId, h.index);
      return;
    }
    const own = (id) => soldierOf(id)?.team === P.state.team;
    const sid = g.soldiers.pick(view.camera, x, y, viewW, viewH, own);
    if (sid !== null) {
      if (sid === P.state.selectedId) P.deselectWaypoint();
      else P.selectSoldier(sid);
      return;
    }
  }
  if (!p) return;
  const ok = P.addWaypoint(p.x, p.z, long ? 'run' : null);
  marker.show(p, ok ? (long ? 0xffb347 : 0x5ad1ff) : 0xff4d4d);
  if (long) navigator.vibrate?.(15);
}

attachGestures(app, {
  onPan: (dx, dy) => rig?.pan(dx, dy),
  onOrbit: (dx, dy) => rig?.orbit(dx, dy),
  onPinch: (scale, cx, cy) => rig?.zoom(scale, cx, cy),
  onTwist: (da) => rig?.rotate(da),
  onWheel: (deltaY, x, y) => rig?.zoom(Math.exp(-deltaY * 0.0015), x, y),
  onTap: ({ x, y }) => handleTap(x, y, false),
  onLongPress: ({ x, y }) => {
    // Holding a waypoint picks it up (then drag it); holding open ground adds a running waypoint.
    if (editing()) {
      const h = g.plans.pickWaypoint(view.camera, x, y, viewW, viewH);
      if (h) {
        g.planning.beginDrag(h.soldierId, h.index);
        navigator.vibrate?.(10);
        return 'drag';
      }
    }
    handleTap(x, y, true);
  },
  onDragStart: ({ x, y }) => {
    if (!editing()) return false;
    const h = g.plans.pickWaypoint(view.camera, x, y, viewW, viewH);
    if (!h) return false;
    g.planning.beginDrag(h.soldierId, h.index);
    return true;
  },
  onDrag: ({ x, y }) => {
    const p = rig.groundAt(x, y);
    if (p) g.planning.dragWaypointTo(p.x, p.z);
  },
});

window.addEventListener('keydown', (e) => {
  if (!g) return;
  if (e.code === 'Space') onAction('togglePause');
  else if (e.code === 'Enter' && editing()) onAction('go');
  else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) onAction('undo');
  else if (e.code === 'Escape') {
    if (g.planning.state.pickMode) g.planning.cancelPick();
    else g.planning.deselectWaypoint();
  } else if (editing() && /^Digit[1-8]$/.test(e.code)) {
    const own = g.match.world.soldiers.filter((s) => s.team === g.planning.state.team);
    const s = own[Number(e.code.slice(5)) - 1];
    if (s) g.planning.selectSoldier(s.id);
  }
});

function onAction(action, arg) {
  const P = g?.planning;
  switch (action) {
    case 'start':
      ui.pendingMode = arg;
      return hud.overlay(squadOverlay(arg));
    case 'cycleMap':
      ui.mapId = cycle(MAP_IDS, ui.mapId);
      return hud.overlay(net ? lobbyOverlay() : squadOverlay(ui.pendingMode));
    case 'cycleMode':
      ui.gameMode = cycle(MODE_IDS, ui.gameMode);
      return hud.overlay(net ? lobbyOverlay() : squadOverlay(ui.pendingMode));
    case 'cycleRole': {
      const [team, i] = arg.split(':');
      ui.squads[team] = cycleRole(ui.squads[team], Number(i));
      return hud.overlay(net ? lobbyOverlay() : squadOverlay(ui.pendingMode));
    }
    case 'startMatch':
      return startMatch(arg);
    case 'quit':
      if (g && g.match.phase !== 'over') {
        g.confirm = overlays.message(
          'Quit match?',
          'The match will be lost.',
          '<button data-action="menu" class="go">Quit</button><button data-action="resume">Keep playing</button>',
        );
        return;
      }
      return onAction('menu');
    case 'resume':
      if (g) g.confirm = null;
      return;
    case 'menu':
      endMatch();
      leaveRoom();
      return hud.overlay(overlays.menu());
    case 'onlineMenu':
      return hud.overlay(overlays.online());
    case 'howTo':
      return hud.overlay(overlays.howTo());
    case 'loadReplay':
      return pickReplayFile();
    case 'onlineCreate':
      return enterRoom(randomRoomCode(), true);
    case 'onlineJoin': {
      const code = document.getElementById('room-code')?.value.trim().toUpperCase();
      if (!code || code.length < 4) return hud.overlay(overlays.online('Enter the room code from your opponent.'));
      return enterRoom(code, false);
    }
    case 'shareRoom': {
      const url = `${location.origin}${location.pathname}?room=${net.code}`;
      if (navigator.share) navigator.share({ title: 'Tactical', text: `Join my Tactical match (room ${net.code})`, url }).catch(() => {});
      else navigator.clipboard?.writeText(url);
      return;
    }
    case 'onlineReady':
      if (!net) return;
      net.ready = true;
      net.session.ready(ui.squads[net.isHost ? 'A' : 'B'], { map: ui.mapId, mode: ui.gameMode });
      if (!g) hud.overlay(lobbyOverlay());
      return;
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
      return;
  }
  if (!g) return;
  switch (action) {
    case 'togglePause':
      ui.paused = !ui.paused;
      break;
    case 'cycleSpeed':
      ui.speed = SPEEDS[(SPEEDS.indexOf(ui.speed) + 1) % SPEEDS.length];
      break;
    case 'toggleCones':
      ui.showCones = !ui.showCones;
      break;
    case 'togglePlans':
      ui.showPlans = !ui.showPlans;
      break;
    case 'toggleLog':
      ui.logOpen = !ui.logOpen;
      break;
    case 'toggleMute':
      audio.toggleMute();
      break;
    case 'resetCamera':
      rig.reset();
      break;
    case 'toggleAuto':
      ui.auto = !ui.auto;
      break;
    case 'scrub':
      ui.paused = true;
      jumpTo(Number(arg));
      break;
    case 'prevTurn': {
      const t = g.recorder.turnAt(g.cursor);
      const idx = g.recorder.turns.indexOf(t);
      const target = t && g.cursor - t.frame > TICK_RATE / 2 ? t.frame : (g.recorder.turns[idx - 1]?.frame ?? 0);
      jumpTo(target);
      break;
    }
    case 'nextTurn': {
      const next = g.recorder.turns.find((t) => t.frame > g.cursor);
      jumpTo(next ? next.frame : frames().length - 1);
      break;
    }
    case 'goLive':
      jumpTo(frames().length - 1);
      ui.paused = false;
      break;
    case 'continue':
      if (g.match.phase === 'turnEnd' && atLive()) nextTurn();
      break;
    case 'acceptHandoff':
      g.match.acceptHandoff();
      break;
    case 'saveReplay':
      downloadReplay();
      break;
    case 'rewatch':
      g.overShown = true;
      hud.overlay(null);
      jumpTo(0);
      ui.paused = false;
      break;
    case 'go':
      if (!editing()) break;
      if (g.mode === 'online') {
        // Simulate with exactly what the opponent will receive (JSON round-trip).
        const team = g.match.localTeam;
        g.match.drafts[team] = net.session.commit(g.match.turn, g.match.drafts[team]);
      }
      g.match.confirm();
      navigator.vibrate?.(25);
      onPhase();
      break;
    case 'select': {
      // Tapping the already-selected soldier's chip centres the camera on them.
      const id = Number(arg);
      if (P.state.selectedId === id) {
        const s = soldierOf(id);
        if (s) rig.focusOn(s.x, s.z);
      }
      P.selectSoldier(id);
      break;
    }
    case 'undo':
      P.undo();
      break;
    case 'move':
      P.setMove(arg);
      break;
    case 'fire':
      P.setFire(arg);
      break;
    case 'addStance':
      P.addAction({ type: 'stance', stance: arg });
      break;
    case 'addWait':
      P.addAction({ type: 'wait', t: 1 });
      break;
    case 'addSync':
      P.addAction({ type: 'until', t: 1 });
      break;
    case 'pick':
      if (P.state.pickMode === arg) P.cancelPick();
      else P.startPick(arg);
      break;
    case 'removeAction':
      P.removeAction(Number(arg));
      break;
    case 'clearLook':
      P.clearLook();
      break;
    case 'deleteWaypoint':
      P.deleteWaypoint();
      break;
    case 'clearPlan':
      P.clearPlan();
      break;
    case 'holdHere': {
      const s = soldierOf(P.state.selectedId);
      if (!s) break;
      P.clearPlan();
      P.state.drafts[s.id] = [{ ...makeWaypoint(s.x, s.z), actions: [{ type: 'stance', stance: 'crouch' }] }];
      break;
    }
  }
}

// ---------------------------------------------------------------- frame

function updateHud() {
  const { match } = g;
  const P = g.planning;
  const live = atLive();
  const frame = frames()[g.cursor];
  const { turn, sec } = turnTime(g.cursor);
  const alive = (t) => frame.soldiers.filter((s) => s.team === t && s.alive).length;

  let status;
  if (match.phase === 'over' && live) {
    status = match.world.winner === 'draw' ? 'Draw' : `${TEAM_NAMES[match.world.winner]} wins`;
  } else if (!live) status = `Replay · turn ${turn} · ${sec.toFixed(1)}s`;
  else if (match.phase === 'planning') status = `Turn ${match.turn} · ${TEAM_NAMES[match.planningTeam]} planning`;
  else if (match.phase === 'handoff') status = `Turn ${match.turn} · handoff`;
  else if (match.phase === 'waiting') status = `Turn ${match.turn} · waiting for opponent…`;
  else status = `Turn ${match.turn} · ${(g.match.turnTick / TICK_RATE).toFixed(1)}s / ${(TURN_TICKS / TICK_RATE).toFixed(0)}s`;
  const zone = frame.objective ? ` · zone ${frame.objective.score.A.toFixed(0)}–${frame.objective.score.B.toFixed(0)}/${match.world.objective.needed}s` : '';
  hud.status(`${status}\nBlue ${alive('A')} · Red ${alive('B')}${zone}`);
  hud.buttons({ ...ui, muted: audio.muted, inMatch: true });
  hud.log(visibleLog(), ui.logOpen);
  hud.timeline({
    visible: frames().length > 1,
    cursor: g.cursor,
    max: frames().length - 1,
    label: `T${turn} ${sec.toFixed(1)}s`,
    live,
  });

  if (g.confirm) {
    hud.overlay(g.confirm);
  } else if (g.netMessage) {
    hud.overlay(g.netMessage);
  } else if (match.phase === 'handoff') {
    hud.overlay(overlays.handoff(TEAM_NAMES[match.planningTeam]));
  } else if (match.phase === 'over' && live && !g.overShown) {
    hud.overlay(overlays.over(status));
  } else hud.overlay(null);

  if (editing()) {
    const team = P.state.team;
    const own = match.world.soldiers.filter((s) => s.team === team);
    hud.bar({
      kind: 'plan',
      canUndo: P.state.undoStack.length > 0,
      soldiers: own.map((s) => ({
        id: s.id,
        team,
        num: match.labels[s.id].split(' ')[1],
        label: match.labels[s.id],
        hp: Math.max(0, Math.round((100 * s.hp) / s.maxHp)),
        role: ROLES[s.role].short,
        alive: s.alive,
        selected: s.id === P.state.selectedId,
        wps: P.state.drafts[s.id]?.length ?? 0,
      })),
    });
    const s = soldierOf(P.state.selectedId);
    const w = P.selectedWaypoint;
    if (s && w) {
      const est = g.plans.estimates.get(s.id);
      const mark = est?.marks[P.state.wpIndex];
      hud.panel({
        kind: 'waypoint',
        label: match.labels[s.id],
        index: P.state.wpIndex,
        count: P.state.drafts[s.id].length,
        eta: mark ? (Number.isFinite(mark.arrive) ? `${mark.arrive.toFixed(1)}s` : 'unreachable') : '–',
        gear: s.gear,
        charges: s.charges,
        pickMode: P.state.pickMode,
        wp: w,
      });
    } else if (s) {
      hud.panel({
        kind: 'soldier',
        label: `${match.labels[s.id]} · ${ROLES[s.role].label}`,
        weapon: `${WEAPONS[s.weapon].label} ${s.ammo}/${WEAPONS[s.weapon].mag}`,
        hp: Math.max(0, Math.round(s.hp)),
        gear: s.gear,
        wps: P.state.drafts[s.id]?.length ?? 0,
      });
    } else hud.panel(null);

    const hint = P.state.pickMode
      ? PICK_HINTS[P.state.pickMode]
      : net?.opponentReady
        ? 'Opponent is ready'
      : s && !(P.state.drafts[s.id]?.length)
        ? 'Tap the map to add a waypoint · hold for a running one'
        : '';
    hud.hint(hint);
  } else {
    hud.panel(null);
    if (g.mode === 'aiVsAi') {
      hud.bar({ kind: 'spectate', auto: ui.auto, canContinue: match.phase === 'turnEnd' && live });
    } else hud.bar(null);
    hud.hint(match.phase === 'planning' && !live ? 'Watching replay · tap LIVE to keep planning' : '');
  }
}

function drawPlans() {
  const { match } = g;
  const P = g.planning;
  if (!ui.showPlans && !editing()) return g.plans.hide();

  let plans;
  let selected = null;
  if (editing()) {
    const team = P.state.team;
    plans = match.world.soldiers
      .filter((s) => s.team === team && s.alive)
      .map((s) => ({
        soldierId: s.id,
        team,
        start: { x: s.x, z: s.z, stance: s.stance },
        waypoints: P.state.drafts[s.id] ?? [],
        editable: true,
      }));
    selected = P.state.selectedId !== null ? { soldierId: P.state.selectedId, index: P.state.wpIndex } : null;
  } else {
    const t = g.recorder.turnAt(g.cursor);
    if (!t) return g.plans.hide();
    const start = frames()[t.frame];
    const showTeams = g.mode === 'vsAI' ? ['A'] : ['A', 'B'];
    plans = start.soldiers
      .filter((s) => s.alive && showTeams.includes(s.team))
      .map((s) => ({
        soldierId: s.id,
        team: s.team,
        start: { x: s.x, z: s.z, stance: s.stance },
        waypoints: t.plans[s.team][s.id] ?? [],
        editable: false,
      }));
  }
  const doorFrame = editing() ? frames()[frames().length - 1] : frames()[g.recorder.turnAt(g.cursor)?.frame ?? 0];
  const closedDoors = new Set();
  match.world.doors.forEach((d, i) => {
    if ((doorFrame.doors?.[i] ?? 'closed') === 'closed') closedDoors.add(`${d.cx},${d.cz}`);
  });
  const estimates = g.plans.setPlans(match.map, plans, selected, closedDoors);
  g.plans.update(rig.state.distance);

  // ETA labels for the selected soldier while planning.
  if (!editing() || P.state.selectedId === null) return;
  const sid = P.state.selectedId;
  const wps = P.state.drafts[sid] ?? [];
  const est = estimates.get(sid);
  wps.forEach((w, i) => {
    const mark = est?.marks[i];
    const eta = mark && Number.isFinite(mark.arrive) ? `${mark.arrive.toFixed(1)}s` : '✕';
    const icons = w.actions.map((a) => actionLabel(a).split(' ')[0]).join('');
    const cls = `${i === P.state.wpIndex ? 'sel' : ''} ${mark && mark.arrive > TURN_TICKS / TICK_RATE ? 'late' : ''}`;
    labels.add(`${i + 1} · ${eta}${icons ? ` ${icons}` : ''}`, { x: w.x, y: 0.2, z: w.z }, view.camera, viewW, viewH, cls);
  });
  if (est?.atTurnEnd) labels.add('5s', { ...est.atTurnEnd, y: 0.2 }, view.camera, viewW, viewH);
}

view.onResize((w, h) => {
  viewW = w;
  viewH = h;
  rig?.setViewport(w, h);
});

let lastFrame = performance.now();
startLoop({
  update() {
    if (!g) return;
    if (!ui.paused && g.match.phase !== 'handoff') {
      g.budget += ui.speed;
      while (g.budget >= 1) {
        g.budget -= 1;
        if (!advance()) {
          g.budget = 0;
          break;
        }
      }
    }
    // Online: report the end-of-turn state so both sides can detect a desync.
    if (net && g.mode === 'online' && (g.match.phase === 'turnEnd' || g.match.phase === 'over') && !net.sentState.has(g.match.turn)) {
      net.sentState.add(g.match.turn);
      net.session.sendState(g.match.turn, hashWorld(g.match.world));
    }
    if (g.match.phase === 'turnEnd' && atLive()) {
      if (g.mode !== 'aiVsAi') nextTurn();
      else if (ui.auto && !ui.paused && (g.turnEndWait += DT) > 0.8) nextTurn();
    }
  },
  render(alpha) {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    marker.update(dt);
    labels.begin();
    if (g) {
      keyboard.update(rig, dt);
      const f = frames();
      const curr = f[g.cursor];
      const prev = f[Math.max(0, g.cursor - 1)];
      const moving = !ui.paused && g.match.phase === 'simulating' || !atLive();
      const a = moving && !ui.paused ? alpha : 1;
      const selectedId = editing() ? g.planning.state.selectedId : g.watchSelected;
      g.soldiers.draw(prev, curr, a, { viewerTeam: g.match.viewerTeam, selectedId, showCones: ui.showCones });
      g.fx.drawGrenades(prev, curr, a);
      g.fx.drawSmokes(curr);
      g.mapView.userData.setDoors(curr.doors);
      g.mapView.userData.setZone(curr.objective?.holder);
      g.fx.update(dt);
      drawPlans();
      updateHud();
    }
    labels.end();
    view.render();
  },
});

hud.buttons({ inMatch: false });
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) enterRoom(roomParam.toUpperCase(), false);
else hud.overlay(overlays.menu());

// Installable / offline in production builds (service workers need https or localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Dev-only handle for headless browser tests.
if (import.meta.env.DEV) {
  window.__tactical = { view, ui, loadReplayText, get game() { return g; }, get rig() { return rig; } };
}
