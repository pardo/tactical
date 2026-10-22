import * as THREE from 'three';
import { helpFor, describeWaypoint } from './ui/help.js';
import { createGrenadePredictor } from './plan/grenadePath.js';
import './style.css';
import { initPhysics } from './sim/physics.js';
import { TICK_RATE, TURN_TICKS, TURN_SECONDS, DT } from './sim/constants.js';
import { makeWaypoint, GO_CODE_NAMES } from './sim/plan.js';
import { createMatch, TEAM_NAMES } from './game/match.js';
import { ROLES, WEAPONS, DEFAULT_SQUAD, cycleRole } from './sim/roles.js';
import { createRecorder, frameVision as frameVisionSet } from './game/recorder.js';
import { MAPS, DEFAULT_MAP, getMapDef, listMapIds, isCustomMap, saveCustomMap } from './maps/index.js';
import { validateMapDef } from './maps/validate.js';
import { createEditor, blankRows, SIZES } from './ui/editor.js';
import { parseMap, worldToCell } from './sim/map.js';
import { MODES, MODE_IDS } from './sim/objective.js';
import { createScene } from './render/scene.js';
import { createMapView, disposeMapView } from './render/mapView.js';
import { createSoldierView } from './render/soldierView.js';
import { createVisionView } from './render/visionView.js';
import { createPlanView } from './render/planView.js';
import { createFxView } from './render/fxView.js';
import { createCameraRig } from './render/cameraRig.js';
import { createTapMarker } from './render/marker.js';
import { attachGestures } from './ui/gestures.js';
import { createKeyboard } from './ui/keyboard.js';
import { createHud, overlays, actionLabel, GRENADE_ICON } from './ui/hud.js';
import { createLabels } from './ui/labels.js';
import { createPlanning } from './ui/planning.js';
import { startLoop } from './loop.js';
import { createAudio } from './render/audio.js';
import { exportReplay, validateReplay, fastForward, replayMapDef } from './game/replay.js';
import { hashWorld } from './sim/world.js';
import { createSession, shouldAdopt, EMOTES } from './net/session.js';
import { createTrysteroTransport, randomRoomCode } from './net/trystero.js';

await initPhysics();

const SPEEDS = [0.5, 1, 2, 4];
const PICK_HINTS = {
  face: 'Tap the map: where to face',
  faceHere: 'Tap the map: where to face (turns in place)',
  look: 'Tap the map: what to watch while moving',
  'grenade:frag': 'Tap the map: frag target (max 14 m)',
  'grenade:flash': 'Tap the map: flashbang target (max 14 m)',
  'grenade:smoke': 'Tap the map: smoke target (max 14 m)',
  breach: 'Tap the door to blow (stand next to it)',
};
const LOG_LINES = 10;
const EXPLAIN_MS = 8000;
/** Metres of map across a portrait phone screen at the start of a match. */
const PORTRAIT_VIEW_WIDTH = 18;

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
const hud = createHud(document.getElementById('ui'), onAction);
// After the HUD: createHud replaces #ui's contents, which would drop an earlier labels layer.
const labels = createLabels(document.getElementById('ui'));
let viewW = 1;
let viewH = 1;
let rig = null;

const ui = {
  paused: false,
  speed: 1,
  showCones: false,
  /** Camera drifts toward visible firefights during playback until the player moves it. */
  director: true,
  showPlans: true,
  logOpen: true,
  auto: true,
  squads: { A: [...DEFAULT_SQUAD], B: [...DEFAULT_SQUAD] },
  mapId: DEFAULT_MAP,
  gameMode: 'elimination',
  planTimer: 0, // seconds per planning phase, 0 = unlimited
};
const TIMER_OPTIONS = [0, 45, 90, 120];

const settings = () => ({
  mapName: `${isCustomMap(ui.mapId) ? '★ ' : ''}${getMapDef(ui.mapId)?.name ?? '?'}`,
  modeName: MODES[ui.gameMode].label,
  modeHelp: MODES[ui.gameMode].help,
  timer: ui.planTimer,
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

// ------------------------------------------------- online: survive drops and reloads

/**
 * The running online match is saved after every phase change, so a reload or a reopened app can
 * restore it. One entry per room and side (two tabs on one device share localStorage); each tab
 * remembers its own entry in sessionStorage, which survives a reload but not a closed app.
 */
const SAVE_PREFIX = 'tactical:online:';
const SAVE_MAX_AGE = 2 * 60 * 60 * 1000;
/** After a drop, give the transport this long to recover on its own, then rejoin the room every REJOIN_EVERY. */
const REJOIN_AFTER = 6000;
const REJOIN_EVERY = 12000;

/** What a peer needs to rebuild this match (see session `sync`). */
function matchInfo() {
  const m = g.match;
  return { seed: m.seed, squads: m.squads, map: m.mapId, mode: m.gameMode, timer: ui.planTimer, history: m.history, mapDef: isCustomMap(m.mapId) ? m.mapDef : null };
}

const saveKey = () => `${SAVE_PREFIX}${net.code}:${net.isHost ? 'host' : 'guest'}`;

function saveOnline() {
  if (!net || g?.mode !== 'online') return;
  try {
    if (g.match.phase === 'over') return clearSavedOnline();
    localStorage.setItem(saveKey(), JSON.stringify({ code: net.code, isHost: net.isHost, savedAt: Date.now(), ...matchInfo() }));
    sessionStorage.setItem(SAVE_PREFIX, saveKey());
  } catch {
    // Storage full or blocked: reconnecting still works, only a reload can't restore.
  }
}

/**
 * This tab's save if it has one, else the newest recent save (app reopened). A join link
 * (`room`) only ever resumes as the guest of that room.
 */
function loadSavedOnline(room = null) {
  try {
    const read = (k) => JSON.parse(localStorage.getItem(k) ?? 'null');
    const mine = sessionStorage.getItem(SAVE_PREFIX);
    const fresh = (s) => s && Date.now() - s.savedAt < SAVE_MAX_AGE && (!room || s.code === room);
    if (mine && fresh(read(mine))) return read(mine);
    const all = Object.keys(localStorage)
      .filter((k) => k.startsWith(SAVE_PREFIX))
      .map(read)
      .filter((s) => fresh(s) && (!room || !s.isHost));
    return all.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
  } catch {
    return null;
  }
}

function clearSavedOnline() {
  try {
    if (net) localStorage.removeItem(saveKey());
    sessionStorage.removeItem(SAVE_PREFIX);
  } catch {
    // ignore
  }
}

/** Rebuild an online match from a sync message or a save, re-simulating its history. */
function restoreOnline(info, localTeam) {
  if (info.timer) ui.planTimer = info.timer;
  startMatch('online', {
    seed: info.seed,
    squads: info.squads,
    localTeam,
    ...onlineMap(info),
    gameMode: MODES[info.mode] ? info.mode : ui.gameMode,
    history: info.history,
  });
}

/** Reopen a saved online match (after a reload) and rejoin its room; the peer brings us up to date. */
function resumeSavedOnline(saved) {
  enterRoom(saved.code, saved.isHost);
  if (!net) return;
  net.session.markStarted();
  restoreOnline(saved, saved.isHost ? 'A' : 'B');
  net.lostAt = performance.now();
  g.netBanner = '⏳ Rejoining the match…';
}

/** Leave and rejoin the room through a fresh connection, keeping the match and pending GO. */
function rejoinRoom() {
  if (!net) return;
  net.lastRejoin = performance.now();
  try {
    net.session.useTransport(() => createTrysteroTransport(net.code));
  } catch {
    // Offline right now: try again on the next round.
  }
}

/** Called every frame: keep retrying while an online match has lost its peer. */
function keepConnected(now) {
  if (!net || g?.mode !== 'online' || net.connected || g.match.phase === 'over') return;
  if (now - (net.lostAt ?? now) < REJOIN_AFTER || now - (net.lastRejoin ?? 0) < REJOIN_EVERY) return;
  rejoinRoom();
}

// Back online, or the app came back to the foreground: retry straight away.
const retrySoon = () => {
  if (net && g?.mode === 'online' && !net.connected) rejoinRoom();
};
window.addEventListener('online', retrySoon);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && retrySoon());

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
  // Trystero needs WebCrypto, which browsers only enable on https or localhost (not http://192.168.x.x).
  if (!window.isSecureContext) {
    return hud.overlay(overlays.online('Online play needs a secure (https) link. Open the game through its https address instead.'));
  }
  // Online games default to a planning clock so nobody can stall.
  if (!ui.planTimer) ui.planTimer = 90;
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
      else if (g.mode === 'online') {
        // (Re)connected mid-match: both sides send what they have; the one behind catches up.
        net.session.sync(matchInfo());
        g.netBanner = null;
        g.toast = { text: '✅ Connected', until: performance.now() + 2000 };
        g.log.push({ i: g.cursor, team: null, cls: 'note', text: 'Opponent connected' });
      }
      break;
    case 'peerLeft':
      net.connected = false;
      if (g) {
        // Keep playing locally (the current turn needs no network); GO is re-sent on reconnect.
        net.lostAt = performance.now();
        g.netBanner = '⚠ Connection lost · reconnecting…';
      } else hud.overlay(lobbyOverlay());
      break;
    case 'versionMismatch':
      hud.overlay(overlays.message('Version mismatch', 'Both players need the same game version. Reload and try again.'));
      break;
    case 'sync': {
      const local = g?.mode === 'online' ? { seed: g.match.seed, history: g.match.history } : null;
      if (shouldAdopt(local, e)) {
        restoreOnline(e, e.localTeam);
        g?.log.push({ i: g.cursor, team: null, cls: 'note', text: `Caught up: turn ${g.match.turn}` });
        saveOnline();
      }
      if (g) {
        g.netBanner = null;
        net.session.recommit(g.match.turn);
      }
      break;
    }
    case 'start':
      if (!net.isHost) ui.planTimer = e.timer ?? 0;
      startMatch('online', {
        seed: e.seed,
        squads: e.squads,
        localTeam: e.localTeam,
        ...onlineMap(e),
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
    case 'emote':
      if (g) g.toast = { text: `Opponent: ${e.emote}`, until: performance.now() + 2500 };
      break;
    case 'cheat':
      if (g) g.netMessage = overlays.message('Invalid plan', "The opponent's plan did not match what they committed to.");
      break;
  }
}

/** Map for an online start/resume: a built-in id, or the host's custom map if it validates. */
function onlineMap(e) {
  if (MAPS[e.map]) return { mapId: e.map };
  if (e.mapDef && validateMapDef(e.mapDef).ok) return { mapId: e.map, mapDef: { name: String(e.mapDef.name), rows: e.mapDef.rows } };
  return { mapId: DEFAULT_MAP };
}

function startMatch(mode, opts = {}) {
  endMatch();
  closeEditor();
  const seed = opts.seed ?? (Math.random() * 2 ** 31) >>> 0;
  const squads =
    opts.squads ?? (mode === 'aiVsAi' ? {} : mode === 'vsAI' ? { A: ui.squads.A } : { A: ui.squads.A, B: ui.squads.B });
  const mapId = opts.mapId ?? ui.mapId;
  const gameMode = opts.gameMode ?? ui.gameMode;
  const mapDef = opts.mapDef ?? getMapDef(mapId) ?? MAPS[DEFAULT_MAP];
  const match = createMatch({ mode, mapDef, mapId, seed, squads, localTeam: opts.localTeam, gameMode });
  const { map } = match;
  const half = Math.max(map.width, map.height) / 2;
  view.setShadowBounds(half + 2);
  // Start framed on your own squad (spectators: whole map), looking toward the enemy.
  const own = mode === 'hotseat' ? 'A' : match.viewerTeam;
  rig = createCameraRig(view.camera, { bounds: { x: map.width / 2, z: map.height / 2 }, distance: map.width * 0.8 });
  rig.setViewport(viewW, viewH);
  if (own) {
    const v = teamView(match, own);
    rig.glideTo(v, { instant: true });
    rig.setHome(v);
  } else rig.fitWidth(Math.max(map.width, viewW < viewH ? 0 : map.height * (viewW / viewH))); // spectating: whole map in view

  g = {
    mode,
    seed,
    match,
    recorder: createRecorder(match.world),
    mapView: createMapView(view.scene, map, match.world.objective),
    soldiers: createSoldierView(view.scene, match.labels),
    vision: createVisionView(view.scene, map),
    plans: createPlanView(view.scene),
    fx: createFxView(view.scene, map),
    planning: createPlanning(map),
    planDeadline: null,
    cursor: 0,
    budget: 0,
    turnEndWait: 0,
    log: [],
    overShown: false,
    watchSelected: null,
    netMessage: null,
    netBanner: null, // online connection trouble, shown as a hint (not a blocking overlay)
    confirm: null,
    toast: null,
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
  if (opts.history?.length) {
    // Rejoining an online match: re-simulate what we missed, then continue live.
    fastForward(match, opts.history, {
      onTurn: () => onPhase(),
      onTick: (w) => {
        g.recorder.record(w);
        logFrame(frames().length - 1, frames()[frames().length - 1]);
      },
    });
    g.cursor = frames().length - 1;
    if (match.phase === 'over') return;
    // A turn still simulating on the host is already in the history; otherwise plan the next one.
    if (match.phase === 'turnEnd') nextTurn();
    return;
  }
  nextTurn();
}

function downloadReplay() {
  const data = exportReplay(g.match);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  downloadJson(data, `tactical-${data.mapId.replace(/[^a-z0-9]+/gi, '-')}-${stamp}.json`);
}

function loadReplayText(text) {
  try {
    const data = validateReplay(JSON.parse(text));
    startMatch('replay', {
      seed: data.seed,
      squads: data.squads,
      mapId: data.mapId,
      mapDef: replayMapDef(data),
      gameMode: data.gameMode,
      replay: data,
    });
  } catch (err) {
    hud.overlay(overlays.message('Could not load replay', err.message));
  }
}

function endMatch() {
  if (!g) return;
  disposeMapView(view.scene, g.mapView);
  g.soldiers.dispose();
  g.vision.dispose();
  g.plans.hide();
  g.fx.clear();
  g.predictor?.dispose();
  g = null;
}

const frames = () => g.recorder.frames;
const atLive = () => g.cursor >= frames().length - 1;
const editing = () => g && g.match.phase === 'planning' && atLive();
const soldierOf = (id) => g.match.world.soldiers.find((s) => s.id === id);

const centroid = (list) => ({ x: list.reduce((a, s) => a + s.x, 0) / list.length, z: list.reduce((a, s) => a + s.z, 0) / list.length });

/**
 * Camera framing for a team: rotated so the enemy side is "up" the screen, with the squad
 * in the lower part of the view and the map ahead of it filling the rest. Portrait phones
 * zoom so the map's cross-section (capped) fits the screen width.
 */
function teamView(match, team) {
  const { map } = match;
  const alive = match.world.soldiers.filter((s) => s.alive);
  const mine = alive.filter((s) => s.team === team);
  const theirs = alive.filter((s) => s.team !== team);
  if (!mine.length) return null;
  const c = centroid(mine);
  const e = theirs.length ? centroid(theirs) : { x: 0, z: 0 };
  let fx = e.x - c.x;
  let fz = e.z - c.z;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len;
  fz /= len;
  // Square to the grid: walls read best straight up/across the screen.
  if (Math.abs(fx) > Math.abs(fz)) [fx, fz] = [Math.sign(fx), 0];
  else [fx, fz] = [0, Math.sign(fz) || -1];
  const portrait = viewW < viewH;
  const across = fx ? map.height : map.width;
  const distance = portrait ? rig.distanceForWidth(Math.min(across, PORTRAIT_VIEW_WIDTH)) : Math.max(map.width, map.height) * 0.6;
  // Look ahead of the squad: they sit low on screen, the ground toward the enemy above them.
  const ahead = Math.min(len * 0.4, distance * 0.16);
  let x = c.x + fx * ahead;
  let z = c.z + fz * ahead;
  // Across the screen, keep the view's edges inside the map rather than showing the void past it.
  const viewHalf = Math.min(across, PORTRAIT_VIEW_WIDTH) / 2;
  const slack = Math.max(0, across / 2 - viewHalf);
  if (portrait && fx) z = THREE.MathUtils.clamp(z, -slack, slack);
  else if (portrait) x = THREE.MathUtils.clamp(x, -slack, slack);
  return { x, z, yaw: Math.atan2(-fx, -fz), distance };
}

/** Point the camera at a team's living soldiers, facing the enemy side. */
function frameTeam(team) {
  const v = teamView(g.match, team);
  if (!v) return;
  rig.glideTo(v, { rate: 4 });
  rig.setHome(v);
}

/**
 * Playback director: while a turn plays and the player hasn't moved the camera, drift
 * toward firefights the viewer can see if they're near the edge of the screen.
 */
const directorPt = new THREE.Vector3();
function directCamera(curr) {
  if (!ui.director || rig.userMoved || g.watchSelected !== null || rig.gliding()) return;
  const team = g.match.viewerTeam;
  const shown = team ? frameVisionSet(curr, team) : null;
  const pts = [];
  for (const s of curr.soldiers) {
    if (!s.alive || !s.visible.length) continue;
    if (team && s.team !== team) continue;
    pts.push(s);
    for (const id of s.visible) {
      const e = curr.soldiers.find((o) => o.id === id);
      if (e && (!shown || shown.has(id) || e.team === team)) pts.push(e);
    }
  }
  if (!pts.length) return;
  const c = centroid(pts);
  directorPt.set(c.x, 0.5, c.z).project(view.camera);
  // Inside the middle of the screen already: leave the camera alone.
  if (Math.abs(directorPt.x) < 0.45 && Math.abs(directorPt.y) < 0.4) return;
  rig.glideTo({ x: c.x, z: c.z }, { rate: 1.2 });
}

function nextTurn() {
  g.turnEndWait = 0;
  g.match.beginTurn();
  onPhase();
}

function onPhase() {
  saveOnline();
  const { match } = g;
  if (match.phase === 'planning') {
    g.planning.begin(match.planningTeam, match.drafts[match.planningTeam], () => match.world.soldiers);
    g.planDeadline = ui.planTimer && g.mode !== 'replay' ? performance.now() + ui.planTimer * 1000 : null;
    if (g.mode === 'hotseat') frameTeam(match.planningTeam);
  } else if (match.phase === 'simulating') {
    const notes = { ...match.aiNotes.A, ...match.aiNotes.B };
    g.recorder.startTurn(match.turn, match.drafts, notes);
    const frame = frames().length - 1;
    for (const [id, note] of Object.entries(notes)) {
      const s = soldierOf(Number(id));
      g.log.push({ i: frame, team: s.team, cls: 'note', text: `T${match.turn} ${match.labels[id]}: ${note}` });
    }
    ui.paused = false;
    rig.userMoved = false;
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
  toastFrame(frame);
  if (ui.speed <= 2) {
    const r = rig.state;
    audio.play(frame, { x: r.x, z: r.z, yaw: r.yaw, range: r.distance });
  }
}

function turnTime(i) {
  const t = g.recorder.turnAt(i);
  return t ? { turn: t.turn, sec: (i - t.frame) / TICK_RATE } : { turn: 0, sec: 0 };
}

/** Short on-screen announcements for big moments, respecting fog of war. */
function toastFrame(frame) {
  const L = g.match.labels;
  const viewer = g.match.viewerTeam;
  const vision = viewer ? frameVisionSet(frame, viewer) : null;
  const known = (id) => !vision || soldierOf(id).team === viewer || vision.has(id);
  for (const e of frame.events) {
    let text = null;
    if (e.type === 'death' && known(e.id)) text = `☠ ${L[e.id]} down`;
    else if (e.type === 'breach' && known(e.id)) text = `💥 ${L[e.id]} breaches a door`;
    else if (e.type === 'blinded' && known(e.id)) text = `⚡ ${L[e.id]} blinded`;
    else if (e.type === 'noise' && e.kind === 'door' && viewer && e.heardBy === viewer && !vision.has(e.id)) text = '🔊 You hear a door open';
    if (text) g.toast = { text, until: performance.now() + 2200 };
  }
}

const NOISE_TEXT = { step: 'running footsteps', door: 'a door', breach: 'a breach', shot: 'gunfire' };

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
    } else if (e.type === 'noise') {
      // Only news if the listeners can't already see the source.
      if (frameVisionSet(frame, e.heardBy).has(e.id)) continue;
      // Footsteps and gunfire repeat: log them at most once every 2 s per soldier.
      if (e.kind !== 'door' && e.kind !== 'breach' && g.log.some((l) => l.noise === e.id && l.kind === e.kind && i - l.i < 120)) continue;
      g.log.push({ i, team: e.heardBy, cls: e.heardBy, noise: e.id, kind: e.kind, text: `${ts} 🔊 ${e.heardBy === 'A' ? 'Blue' : 'Red'} hears ${NOISE_TEXT[e.kind]}` });
    } else if (e.type === 'reload') {
      g.log.push({ i, team: team(e.id), cls: team(e.id), text: `${ts} ${L[e.id]} reloading` });
    }
  }
}

function visibleLog() {
  // Don't leak the opponent's side of the log while the match is on; once it is over, show everything.
  const opponent = g.mode === 'vsAI' ? 'B' : g.mode === 'online' ? (g.match.localTeam === 'A' ? 'B' : 'A') : null;
  const hideTeam = g.match.phase !== 'over' ? opponent : null;
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

// ---------------------------------------------------------------- map editor

/** Editor session: { editor, group, built, map, validation, note }, or null. */
let ed = null;

function openEditor(def) {
  endMatch();
  closeEditor();
  ed = { editor: createEditor({ name: def.name, rows: def.rows }), group: null, built: -1, size: '', map: null, validation: null, note: '' };
  hud.overlay(null);
  buildEditorView();
}

function closeEditor() {
  if (!ed) return;
  if (ed.group) disposeMapView(view.scene, ed.group);
  ed = null;
}

/** Rebuild the 3D map after edits (cheap at these sizes); new camera when the size changes. */
function buildEditorView() {
  const E = ed.editor;
  if (ed.built === E.state.version) return;
  ed.built = E.state.version;
  if (ed.group) disposeMapView(view.scene, ed.group);
  const def = E.toDef();
  ed.map = parseMap(def);
  ed.group = createMapView(view.scene, ed.map, { type: 'zone', x: 0, z: 0, r: 3 });
  ed.validation = validateMapDef(def);
  const size = `${ed.map.width}x${ed.map.height}`;
  if (ed.size !== size) {
    ed.size = size;
    const half = Math.max(ed.map.width, ed.map.height) / 2;
    view.setShadowBounds(half + 2);
    rig = createCameraRig(view.camera, { bounds: half, distance: ed.map.width * 0.8 });
    rig.setViewport(viewW, viewH);
    rig.fitWidth(ed.map.width);
  }
}

function editorPaintAt(x, y) {
  const p = rig.groundAt(x, y);
  if (!p) return;
  const { cx, cz } = worldToCell(ed.map, p.x, p.z);
  if (ed.editor.paint(cx, cz)) ed.note = '';
}

function updateEditorHud() {
  const E = ed.editor;
  const v = ed.validation;
  hud.status(`Map editor · ${E.width}×${E.height}`);
  hud.buttons({ inMatch: false });
  hud.log([], false);
  hud.timeline({ visible: false });
  hud.hint(ed.note);
  hud.overlay(null);
  hud.bar({ kind: 'editor', tool: E.state.tool, canUndo: E.state.undoStack.length > 0 });
  hud.panel({ kind: 'editor', name: E.state.name, ok: v.ok, errors: v.errors, warnings: v.warnings });
}

function downloadJson(data, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function pickJsonFile(onText) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) onText(await file.text());
  };
  input.click();
}

function importMapText(text) {
  try {
    const def = JSON.parse(text);
    const v = validateMapDef(def);
    // Playability problems can be fixed in the editor; malformed files can't.
    if (v.errors.some((e) => /rows|unknown tile|size/.test(e))) throw new Error(v.errors[0]);
    ed.editor.reset(def.rows);
    ed.editor.state.name = String(def.name ?? 'Imported map').slice(0, 24);
    ed.note = 'Map imported';
  } catch (err) {
    ed.note = `Import failed: ${err.message}`;
  }
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
    g.explain = null; // back to the summary, which now includes the new order
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
  onTap: ({ x, y }) => {
    if (ed) {
      ed.editor.beginStroke();
      return editorPaintAt(x, y);
    }
    handleTap(x, y, false);
  },
  onLongPress: ({ x, y }) => {
    // Editor: press-and-hold starts a paint stroke, same as dragging straight away.
    if (ed) {
      ed.editor.beginStroke();
      editorPaintAt(x, y);
      return 'drag';
    }
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
    // Editor: one finger paints (two fingers still pan/zoom/rotate).
    if (ed) {
      ed.editor.beginStroke();
      editorPaintAt(x, y);
      return true;
    }
    if (!editing()) return false;
    const h = g.plans.pickWaypoint(view.camera, x, y, viewW, viewH);
    if (!h) return false;
    g.planning.beginDrag(h.soldierId, h.index);
    return true;
  },
  onDrag: ({ x, y }) => {
    if (ed) return editorPaintAt(x, y);
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
      ui.mapId = cycle(listMapIds(), ui.mapId);
      return hud.overlay(net ? lobbyOverlay() : squadOverlay(ui.pendingMode));
    case 'cycleMode':
      ui.gameMode = cycle(MODE_IDS, ui.gameMode);
      return hud.overlay(net ? lobbyOverlay() : squadOverlay(ui.pendingMode));
    case 'cycleTimer':
      ui.planTimer = cycle(TIMER_OPTIONS, ui.planTimer);
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
      // Quitting on purpose: forget the saved online match too.
      if (g?.mode === 'online') clearSavedOnline();
      endMatch();
      leaveRoom();
      return hud.overlay(overlays.menu());
    case 'onlineMenu':
      return hud.overlay(overlays.online());
    case 'howTo':
      ui.menuOpen = false;
      if (g) g.help = true; // drawn by the frame loop, over the game
      return hud.overlay(overlays.howTo(!!g));
    case 'closeHelp':
      if (g) g.help = false;
      return hud.overlay(null);
    case 'editor': {
      const def = getMapDef(ui.mapId) ?? MAPS[DEFAULT_MAP];
      return openEditor({ name: isCustomMap(ui.mapId) ? def.name : `${def.name} copy`, rows: def.rows });
    }
    case 'loadReplay':
      return pickJsonFile(loadReplayText);
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
      net.session.ready(ui.squads[net.isHost ? 'A' : 'B'], {
        map: ui.mapId,
        mode: ui.gameMode,
        timer: ui.planTimer,
        mapDef: isCustomMap(ui.mapId) ? getMapDef(ui.mapId) : undefined,
      });
      if (!g) hud.overlay(lobbyOverlay());
      return;
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
      return;
  }
  if (ed) return onEditorAction(action, arg);
  if (!g) return;
  switch (action) {
    case 'togglePause':
      ui.paused = !ui.paused;
      break;
    case 'cycleSpeed':
      ui.speed = SPEEDS[(SPEEDS.indexOf(ui.speed) + 1) % SPEEDS.length];
      break;
    case 'toggleDirector':
      ui.director = !ui.director;
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
    case 'toggleMenu':
      ui.menuOpen = !ui.menuOpen;
      break;
    case 'emote':
      net?.session.emote(arg);
      g.toast = { text: `You: ${arg}`, until: performance.now() + 1500 };
      ui.menuOpen = false;
      break;
    case 'resetCamera':
      rig.reset();
      ui.menuOpen = false;
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
      onPhase(); // set up planning (and the clock) for the second player
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
      explain(action, arg);
      P.setMove(arg);
      break;
    case 'fire':
      explain(action, arg);
      P.setFire(arg);
      break;
    case 'cycleMove': {
      const next = P.selectedWaypoint?.move === 'run' ? 'walk' : 'run';
      explain('move', next);
      P.setMove(next);
      break;
    }
    case 'cycleFire': {
      const order = ['onSight', 'return', 'hold'];
      const next = order[(order.indexOf(P.selectedWaypoint?.fire) + 1) % order.length];
      explain('fire', next);
      P.setFire(next);
      break;
    }
    case 'addStance':
      explain(action, arg);
      P.addAction({ type: 'stance', stance: arg });
      break;
    case 'addWait':
      explain(action, arg);
      P.addAction({ type: 'wait', t: 1 });
      break;
    case 'addCover':
      explain(action, arg);
      P.addAction({ type: 'cover' });
      break;
    case 'addCode':
      explain(action, arg);
      P.addAction({ type: 'code', code: 'A' });
      break;
    case 'toggleGo':
      explain(action, arg);
      P.toggleGo(arg);
      break;
    case 'addSync':
      explain(action, arg);
      P.addAction({ type: 'until', t: 1 });
      break;
    case 'pick':
      explain(action, arg);
      if (P.state.pickMode === arg) P.cancelPick();
      else P.startPick(arg);
      break;
    case 'cancelPick':
      P.cancelPick();
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

/** Show what a tapped planning control does (phones have no tooltips) for a few seconds, on this waypoint only. */
function explain(action, arg) {
  const P = g.planning;
  g.explain = { text: helpFor(action, arg), at: `${P.state.selectedId}:${P.state.wpIndex}`, until: performance.now() + EXPLAIN_MS };
}

function onEditorAction(action, arg) {
  const E = ed.editor;
  const def = () => E.toDef();
  switch (action) {
    case 'tool':
      E.state.tool = arg;
      break;
    case 'editorUndo':
      E.undo();
      break;
    case 'editorName':
      E.state.name = String(arg).slice(0, 24);
      break;
    case 'editorSize': {
      const i = SIZES.findIndex(([w, h]) => w === E.width && h === E.height);
      const [w, h] = SIZES[(i + 1) % SIZES.length];
      E.reset(blankRows(w, h));
      ed.note = `New blank ${w}×${h} map`;
      break;
    }
    case 'editorSave':
    case 'editorTest': {
      if (!ed.validation.ok) {
        ed.note = 'Fix the problems listed first';
        break;
      }
      const id = saveCustomMap(def());
      if (!id) {
        ed.note = 'Could not save (storage unavailable)';
        break;
      }
      ui.mapId = id;
      if (action === 'editorSave') {
        ed.note = `Saved "${def().name}"`;
        break;
      }
      closeEditor();
      ui.pendingMode = 'vsAI';
      hud.overlay(squadOverlay('vsAI'));
      break;
    }
    case 'editorExport':
      downloadJson(def(), `tactical-map-${def().name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`);
      break;
    case 'editorImport':
      pickJsonFile(importMapText);
      break;
    case 'editorExit':
      closeEditor();
      hud.panel(null);
      hud.bar(null);
      hud.hint('');
      hud.status('');
      hud.overlay(overlays.menu());
      break;
    case 'fullscreen':
      break;
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
  else if (match.phase === 'planning') {
    const left = g.planDeadline ? Math.max(0, Math.ceil((g.planDeadline - performance.now()) / 1000)) : null;
    status = `Turn ${match.turn} · ${TEAM_NAMES[match.planningTeam]} planning${left !== null ? ` · ⏱ ${left}s` : ''}`;
  }
  else if (match.phase === 'handoff') status = `Turn ${match.turn} · handoff`;
  else if (match.phase === 'waiting') status = `Turn ${match.turn} · waiting for opponent…`;
  else status = `Turn ${match.turn} · ${(g.match.turnTick / TICK_RATE).toFixed(1)}s / ${(TURN_TICKS / TICK_RATE).toFixed(0)}s`;
  const zone = frame.objective ? ` · zone ${frame.objective.score.A.toFixed(0)}–${frame.objective.score.B.toFixed(0)}/${match.world.objective.needed}s` : '';
  // One short line on phones: soldiers left per side as 🔵4 🔴3.
  hud.status(`${status} · 🔵${alive('A')} 🔴${alive('B')}${zone}`);
  // Pause / speed only matter while something is playing back.
  const watching = g.match.phase === 'simulating' || g.match.phase === 'over' || !atLive() || g.mode === 'aiVsAi' || g.mode === 'replay';
  hud.buttons({ ...ui, muted: audio.muted, inMatch: true, emotes: g.mode === 'online' ? EMOTES : null, watching });
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
  } else if (g.help) {
    hud.overlay(overlays.howTo(true));
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
      codes: P.usedCodes.map((code) => ({ code, on: (P.state.drafts.go ?? []).includes(code) })),
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
        booms: (mark?.booms ?? []).map((b, k) => {
          const gr = est?.grenades?.filter((x) => x.wpIndex === P.state.wpIndex)[k];
          return {
            icon: GRENADE_ICON[b.kind],
            at: b.at,
            late: b.at > TURN_SECONDS,
            bounces: gr?.bounces.length ?? 0,
            hits: (gr?.danger ?? []).map((id) => match.labels[id]),
          };
        }),
        eta: mark ? (mark.held ? `after go code ${GO_CODE_NAMES[mark.held]}` : Number.isFinite(mark.arrive) ? `${mark.arrive.toFixed(1)}s` : 'unreachable') : '–',
        gear: s.gear,
        charges: s.charges,
        pickMode: P.state.pickMode,
        wp: w,
        summary: describeWaypoint(w),
        explain: g.explain?.at === `${s.id}:${P.state.wpIndex}` && performance.now() < g.explain.until ? g.explain.text : null,
      });
    } else if (s) {
      hud.panel({
        kind: 'soldier',
        label: `${match.labels[s.id]} · ${ROLES[s.role].label}`,
        weapon: `${WEAPONS[s.weapon].label} ${s.ammo}/${WEAPONS[s.weapon].mag}`,
        hp: Math.max(0, Math.round(s.hp)),
        gear: s.gear,
        wps: P.state.drafts[s.id]?.length ?? 0,
        pickMode: P.state.pickMode,
        canFaceHere: P.canFaceHere,
        explain: g.explain?.at === `${s.id}:null` && performance.now() < g.explain.until ? g.explain.text : null,
      });
    } else hud.panel(null);

    const toastText = g.toast && performance.now() < g.toast.until ? g.toast.text : '';
    const hint = g.netBanner
      ? g.netBanner
      : P.state.pickMode
      ? PICK_HINTS[P.state.pickMode]
      : toastText
        ? toastText
      : net?.opponentReady
        ? 'Opponent is ready'
      : s && !(P.state.drafts[s.id]?.length)
        ? 'Tap map: walk here · hold: run'
        : '';
    hud.hint(hint);
  } else {
    hud.panel(null);
    if (g.mode === 'aiVsAi') {
      hud.bar({ kind: 'spectate', auto: ui.auto, canContinue: match.phase === 'turnEnd' && live });
    } else hud.bar(null);
    const toast = g.toast && performance.now() < g.toast.until ? g.toast.text : '';
    hud.hint(g.netBanner ?? (match.phase === 'planning' && !live ? 'Watching replay · tap LIVE to keep planning' : toast));
  }
}

/** Grenade flight predictor for the map as it is now (doors, destroyed cover); rebuilt when that changes. */
function grenadePredictor() {
  const w = g.match.world;
  const key = `${w.doors.map((d) => d.state[0]).join('')}:${w.destroyed.length}`;
  if (g.predictor?.key !== key) {
    g.predictor?.dispose();
    g.predictor = { ...createGrenadePredictor(w), key, id: (g.predictor?.id ?? 0) + 1 };
  }
  return g.predictor;
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
        released: P.state.drafts.go ?? [],
      }));
    selected = P.state.selectedId !== null ? { soldierId: P.state.selectedId, index: P.state.wpIndex } : null;
  } else {
    const t = g.recorder.turnAt(g.cursor);
    if (!t) return g.plans.hide();
    const start = frames()[t.frame];
    // While the match is on, only your own side's plans (an opponent's later waypoints would give away their intent).
    const own = g.mode === 'vsAI' ? 'A' : g.mode === 'online' ? match.localTeam : null;
    const showTeams = own && match.phase !== 'over' ? [own] : ['A', 'B'];
    plans = start.soldiers
      .filter((s) => s.alive && showTeams.includes(s.team))
      .map((s) => ({
        soldierId: s.id,
        team: s.team,
        start: { x: s.x, z: s.z, stance: s.stance },
        waypoints: t.plans[s.team][s.id] ?? [],
        editable: false,
        released: t.plans[s.team].go ?? [],
      }));
  }
  const doorFrame = editing() ? frames()[frames().length - 1] : frames()[g.recorder.turnAt(g.cursor)?.frame ?? 0];
  const closedDoors = new Set();
  match.world.doors.forEach((d, i) => {
    if ((doorFrame.doors?.[i] ?? 'closed') === 'closed') closedDoors.add(`${d.cx},${d.cz}`);
  });
  const estimates = g.plans.setPlans(match.map, plans, selected, closedDoors, grenadePredictor());
  g.plans.update(rig.state.distance);

  // ETA labels for the selected soldier while planning.
  if (!editing() || P.state.selectedId === null) return;
  const sid = P.state.selectedId;
  const wps = P.state.drafts[sid] ?? [];
  const est = estimates.get(sid);
  wps.forEach((w, i) => {
    const mark = est?.marks[i];
    const eta = mark?.held ? `⏸${mark.held}` : mark && Number.isFinite(mark.arrive) ? `${mark.arrive.toFixed(1)}s` : '✕';
    // A grenade that would go off after the 5 s is marked ⏭ (it carries over into next turn).
    let k = 0;
    const icons = w.actions
      .map((a) => {
        const icon = actionLabel(a).split(' ')[0];
        return a.type === 'grenade' && mark?.booms[k++]?.at > TURN_SECONDS ? `${icon}⏭` : icon;
      })
      .join('');
    const cls = `${i === P.state.wpIndex ? 'sel' : ''} ${mark && !mark.held && mark.arrive > TURN_TICKS / TICK_RATE ? 'late' : ''}`;
    labels.add(`${i + 1} · ${eta}${icons ? ` ${icons}` : ''}`, { x: w.x, y: 0.2, z: w.z }, view.camera, viewW, viewH, cls);
  });
  // Where each of the selected soldier's grenades goes off, flagging bounces and friendly fire.
  for (const gr of est?.grenades ?? []) {
    const warn = gr.danger.length ? ` ⚠ hits ${gr.danger.map((id) => match.labels[id].split(' ')[1]).join(', ')}` : '';
    const text = `${GRENADE_ICON[gr.kind]}${gr.bounces.length ? ' ↩ bounces' : ''}${warn}`;
    labels.add(text, { ...gr.burst, y: 0.3 }, view.camera, viewW, viewH, warn ? 'danger' : gr.bounces.length ? 'bounce' : '');
  }
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
    // Planning clock ran out: go with whatever is planned.
    if (g.planDeadline && g.match.phase === 'planning' && performance.now() > g.planDeadline) {
      g.planDeadline = null;
      if (!atLive()) jumpTo(frames().length - 1);
      onAction('go');
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
    keepConnected(now);
    marker.update(dt);
    labels.begin();
    if (ed) {
      buildEditorView();
      keyboard.update(rig, dt);
      rig.update(dt);
      updateEditorHud();
    } else if (g) {
      keyboard.update(rig, dt);
      rig.update(dt);
      const f = frames();
      const curr = f[g.cursor];
      const prev = f[Math.max(0, g.cursor - 1)];
      const moving = !ui.paused && g.match.phase === 'simulating' || !atLive();
      const a = moving && !ui.paused ? alpha : 1;
      const selectedId = editing() ? g.planning.state.selectedId : g.watchSelected;
      // Watching: the tapped soldier is followed by the camera (tap again to release).
      if (!editing() && g.watchSelected !== null) {
        const s = curr.soldiers.find((x) => x.id === g.watchSelected);
        const visible = s && (!g.match.viewerTeam || s.team === g.match.viewerTeam || frameVisionSet(curr, g.match.viewerTeam).has(s.id));
        if (s?.alive && visible) rig.focusOn(s.x, s.z);
      }
      if (moving && !ui.paused && g.match.phase === 'simulating') directCamera(curr);
      g.soldiers.draw(prev, curr, a, { viewerTeam: g.match.viewerTeam, selectedId, showCones: ui.showCones, playing: moving && !ui.paused, dt });
      g.vision.draw(prev, curr, a, { viewerTeam: g.match.viewerTeam, selectedId, showCones: ui.showCones });
      // Not playing (planning, paused, scrubbing): show live grenades' fuse and blast radius.
      const still = !moving || ui.paused;
      g.fx.drawGrenades(prev, curr, a, still);
      if (still) {
        for (const gr of curr.grenades) {
          labels.add(`${GRENADE_ICON[gr.kind]} ${Math.max(0, gr.fuse ?? 0).toFixed(1)}s`, { x: gr.x, y: 0.3, z: gr.z }, view.camera, viewW, viewH, 'danger');
        }
      }
      g.fx.drawSmokes(curr);
      g.mapView.userData.setDoors(curr.doors);
      g.mapView.userData.setDestroyed(g.match.world.destroyed.slice(0, curr.destroyed ?? 0));
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
const roomParam = new URLSearchParams(location.search).get('room')?.toUpperCase();
const savedOnline = loadSavedOnline(roomParam);
// An online match interrupted by a reload / closed app comes back where it was.
if (savedOnline) resumeSavedOnline(savedOnline);
else if (roomParam) enterRoom(roomParam, false);
else hud.overlay(overlays.menu());

// Installable / offline in production builds (service workers need https or localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Dev-only handle for headless browser tests.
if (import.meta.env.DEV) {
  window.__tactical = {
    view,
    ui,
    loadReplayText,
    importMapText: (t) => ed && importMapText(t),
    rejoinRoom: () => rejoinRoom(),
    get net() {
      return net;
    },
    get game() {
      return g;
    },
    get rig() {
      return rig;
    },
    get editor() {
      return ed;
    },
  };
}
