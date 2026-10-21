import { TOOLS } from './editor.js';
import { ACTION_HELP } from './help.js';

/**
 * DOM overlay. Buttons carry data-action / data-arg; clicks are delegated to
 * onAction(action, arg). Each section only re-renders when its content key changes.
 */
const ICON = { stance: { crouch: '▼ Crouch', stand: '▲ Stand' }, face: '➜ Face', wait: '⏱ Wait' };
export const GRENADE_ICON = { frag: '💣', flash: '⚡', smoke: '☁' };

const GRENADE_NAME = { frag: 'Frag', flash: 'Flash', smoke: 'Smoke' };

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const btn = (action, label, { arg = '', cls = '', title = '', disabled = false } = {}) =>
  `<button data-action="${action}" data-arg="${esc(arg)}" class="${cls}" title="${esc(title)}" ${disabled ? 'disabled' : ''}>${label}</button>`;
/** Tooltip (desktop) from the shared help text. */
const tip = (key) => ACTION_HELP[key]?.[1] ?? '';

export function actionLabel(a) {
  if (a.type === 'stance') return ICON.stance[a.stance];
  if (a.type === 'wait') return `${ICON.wait} ${a.t}s`;
  if (a.type === 'grenade') return `${GRENADE_ICON[a.kind]} ${GRENADE_NAME[a.kind]}`;
  if (a.type === 'until') return `⏲ @${a.t}s`;
  if (a.type === 'breach') return '🧨 Breach';
  if (a.type === 'cover') return '🛡 Cover';
  return ICON[a.type] ?? a.type;
}

const gearText = (gear) =>
  Object.entries(gear)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${GRENADE_ICON[k]}${n}`)
    .join(' ') || 'no grenades';

export function createHud(root, onAction) {
  root.innerHTML = `
    <div id="top">
      <div class="status"></div>
      <div class="buttons"></div>
    </div>
    <div id="hint"></div>
    <div id="log"></div>
    <div id="bottom">
      <div class="panel"></div>
      <div class="timeline"></div>
      <div class="bar"></div>
    </div>
    <div id="overlay" hidden></div>`;
  const $ = (sel) => root.querySelector(sel);
  const els = {
    status: $('#top .status'),
    buttons: $('#top .buttons'),
    hint: $('#hint'),
    log: $('#log'),
    panel: $('#bottom .panel'),
    timeline: $('#bottom .timeline'),
    bar: $('#bottom .bar'),
    overlay: $('#overlay'),
  };
  const keys = {};
  const set = (name, key, html) => {
    if (keys[name] === key) return;
    keys[name] = key;
    els[name].innerHTML = html;
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    onAction(b.dataset.action, b.dataset.arg);
  });
  // Timeline slider.
  root.addEventListener('input', (e) => {
    if (e.target.matches('input[data-action]')) onAction(e.target.dataset.action, e.target.value);
  });

  return {
    els,

    status(text) {
      if (els.status.textContent !== text) els.status.textContent = text;
      // Last 10 seconds of the planning clock in red.
      const m = /⏱ (\d+)s/.exec(text);
      els.status.classList.toggle('urgent', !!m && Number(m[1]) <= 10);
    },

    hint(text) {
      els.hint.hidden = !text;
      if (els.hint.textContent !== text) els.hint.textContent = text;
    },

    /**
     * Top-right: the few controls used constantly, plus a ⋯ menu (text labels,
     * big targets) for the rest so the bar stays one row on a phone.
     */
    buttons({ paused, speed, showCones, showPlans, logOpen, muted, inMatch, menuOpen, emotes = null }) {
      const toggle = (action, label, on) => btn(action, `${on ? '☑' : '☐'} ${label}`, { cls: on ? 'on' : '' });
      set(
        'buttons',
        JSON.stringify([paused, speed, showCones, showPlans, logOpen, muted, inMatch, menuOpen, emotes]),
        inMatch
          ? `<div class="row1">${btn('togglePause', paused ? '▶' : '⏸', { title: 'Play / pause' })}${btn('cycleSpeed', `${speed}×`, { title: 'Playback speed' })}${btn('toggleMenu', '⋯', { cls: menuOpen ? 'on' : '', title: 'More' })}${btn('quit', '✕', { title: 'Quit to menu' })}</div>` +
              (menuOpen
                ? `<div class="more">${emotes ? `<div class="emotes">${emotes.map((e) => btn('emote', esc(e), { arg: e })).join('')}</div>` : ''}${toggle('toggleLog', 'Event log', logOpen)}${toggle('toggleCones', 'Vision cones', showCones)}${toggle('togglePlans', 'Show plans', showPlans)}${toggle('toggleMute', 'Sound', !muted)}${btn('resetCamera', '⟲ Reset camera')}${btn('fullscreen', '⤢ Fullscreen')}${btn('howTo', '❓ How to play')}</div>`
                : '')
          : btn('fullscreen', '⤢', { title: 'Fullscreen' }),
      );
    },

    log(lines, open) {
      els.log.hidden = !open || !lines.length;
      set('log', JSON.stringify(lines), lines.map((l) => `<div class="${l.cls ?? ''}">${esc(l.text)}</div>`).join(''));
    },

    timeline({ visible, cursor, max, label, live }) {
      els.timeline.hidden = !visible;
      if (!visible) {
        keys.timeline = null;
        return;
      }
      const key = `${max}|${live}`;
      if (keys.timeline !== key) {
        keys.timeline = key;
        els.timeline.innerHTML =
          btn('prevTurn', '⏮', { title: 'Previous turn' }) +
          `<input type="range" min="0" max="${max}" step="1" data-action="scrub" aria-label="Timeline">` +
          btn('nextTurn', '⏭', { title: 'Next turn' }) +
          btn('goLive', 'LIVE', { cls: live ? 'on live' : 'live', title: 'Jump to live' }) +
          `<span class="tl-label"></span>`;
      }
      const range = els.timeline.querySelector('input');
      if (document.activeElement !== range) range.value = cursor;
      const lab = els.timeline.querySelector('.tl-label');
      if (lab.textContent !== label) lab.textContent = label;
    },

    /** Planning bar: soldier chips + undo + go. Spectator bar: auto + next turn. */
    bar(model) {
      if (!model) return set('bar', 'none', '');
      if (model.kind === 'spectate') {
        return set(
          'bar',
          JSON.stringify(model),
          btn('toggleAuto', model.auto ? '⟳ Auto turns: on' : '⟳ Auto turns: off', { cls: model.auto ? 'on' : '' }) +
            btn('continue', 'Next turn ▶', { cls: 'go', disabled: !model.canContinue }),
        );
      }
      if (model.kind === 'editor') {
        return set(
          'bar',
          JSON.stringify(model),
          `<div class="chips">${TOOLS.map((t) => btn('tool', t.label, { arg: t.id, cls: `tool ${model.tool === t.id ? 'sel' : ''}` })).join('')}</div>` +
            btn('editorUndo', '↶', { cls: 'undo', title: 'Undo', disabled: !model.canUndo }),
        );
      }
      if (model.kind === 'continue') {
        return set('bar', JSON.stringify(model), btn('continue', 'Plan next turn ▶', { cls: 'go' }));
      }
      const chips = model.soldiers
        .map((s) =>
          btn('select', `<b>${esc(s.num)}</b><em>${esc(s.role)}</em><i style="--hp:${s.hp}%"></i>${s.wps ? `<small>${s.wps}</small>` : ''}`, {
            arg: s.id,
            cls: `chip team-${s.team} ${s.selected ? 'sel' : ''} ${s.alive ? '' : 'dead'}`,
            disabled: !s.alive,
            title: s.label,
          }),
        )
        .join('');
      set(
        'bar',
        JSON.stringify(model),
        `<div class="chips">${chips}</div>` +
          btn('undo', '↶', { cls: 'undo', title: 'Undo', disabled: !model.canUndo }) +
          btn('go', `GO ▶`, { cls: 'go', title: 'Confirm plan' }),
      );
    },

    /** Contextual panel: selected waypoint editor or soldier summary. */
    panel(model) {
      if (!model) return set('panel', 'none', '');
      if (model.kind === 'editor') {
        // The name is left out of the key so typing doesn't rebuild (and blur) the input.
        const key = JSON.stringify({ ...model, name: null });
        if (keys.panel === key) return;
        keys.panel = key;
        const issues = model.ok
          ? `<div class="row info ok">✓ Playable${model.warnings.length ? ` · ⚠ ${esc(model.warnings[0])}` : ''}</div>`
          : model.errors.map((e) => `<div class="row info err">✗ ${esc(e)}</div>`).join('');
        els.panel.innerHTML = `${issues}
          <div class="row"><input class="map-name" data-action="editorName" maxlength="24" value="${esc(model.name)}" aria-label="Map name" /></div>
          <div class="row">
            ${btn('editorTest', '▶ Test vs AI', { cls: 'go', disabled: !model.ok })}
            ${btn('editorSave', '💾 Save', { disabled: !model.ok })}
            ${btn('editorExport', '⬇ Export')}
            ${btn('editorImport', '📂 Import')}
            ${btn('editorSize', '🆕 New size')}
            ${btn('editorExit', '✕ Exit')}
          </div>`;
        return;
      }
      if (model.kind === 'soldier') {
        return set(
          'panel',
          JSON.stringify(model),
          `<div class="row info">${esc(model.label)} · ${esc(model.weapon)} · HP ${model.hp} · ${gearText(model.gear)} · ${model.wps} waypoint${model.wps === 1 ? '' : 's'}</div>
           <div class="row">${btn('clearPlan', '🗑 Clear plan', { disabled: !model.wps })}${btn('holdHere', '▼ Hold here (crouch)')}</div>`,
        );
      }
      const w = model.wp;
      const actions = w.actions
        .map((a, k) => btn('removeAction', `${actionLabel(a)} ✕`, { arg: k, cls: 'action' }))
        .join('');
      set(
        'panel',
        JSON.stringify(model),
        `<div class="row info">${esc(model.label)} · waypoint ${model.index + 1}/${model.count} · arrive ${model.eta}</div>
         <div class="row seg">
           ${btn('move', '🚶 Walk', { arg: 'walk', cls: w.move === 'walk' ? 'on' : '', title: tip('move:walk') })}${btn('move', '🏃 Run', { arg: 'run', cls: w.move === 'run' ? 'on' : '', title: tip('move:run') })}
           <span class="sep"></span>
           ${btn('fire', '🎯 Fire at will', { arg: 'onSight', cls: w.fire === 'onSight' ? 'on' : '', title: tip('fire:onSight') })}${btn('fire', '↩ Return fire', { arg: 'return', cls: w.fire === 'return' ? 'on' : '', title: tip('fire:return') })}${btn('fire', '🤫 Hold fire', { arg: 'hold', cls: w.fire === 'hold' ? 'on' : '', title: tip('fire:hold') })}
         </div>
         <div class="row">
           ${btn('addCover', '🛡 Take cover', { title: tip('cover') })}
           ${btn('addStance', '▼ Crouch', { arg: 'crouch', title: tip('stance:crouch') })}${btn('addStance', '▲ Stand', { arg: 'stand', title: tip('stance:stand') })}
           ${btn('pick', '➜ Face…', { arg: 'face', cls: model.pickMode === 'face' ? 'on' : '', title: tip('face') })}
           ${btn('addWait', '⏱ +1s', { title: tip('wait') })}
           ${btn('addSync', '⏲ Sync', { title: tip('until') })}
           ${model.charges > 0 ? btn('pick', `🧨 Breach ×${model.charges}…`, { arg: 'breach', cls: model.pickMode === 'breach' ? 'on' : '', title: tip('breach') }) : ''}
           ${['frag', 'flash', 'smoke']
             .filter((k) => model.gear[k] > 0)
             .map((k) => btn('pick', `${GRENADE_ICON[k]} ${GRENADE_NAME[k]} ×${model.gear[k]}…`, { arg: `grenade:${k}`, cls: model.pickMode === `grenade:${k}` ? 'on' : '', title: tip(`grenade:${k}`) }))
             .join('')}
           ${btn('pick', '👁 Look while moving…', { arg: 'look', cls: model.pickMode === 'look' ? 'on' : '', title: tip('look') })}
           ${btn('deleteWaypoint', '🗑', { cls: 'danger', title: 'Delete waypoint' })}
         </div>
         ${actions || w.look ? `<div class="row actions"><span class="lbl">Queued:</span>${w.look ? btn('clearLook', '👁 Look ✕', { cls: 'action' }) : ''}${actions}</div>` : ''}
         <div class="row explain">${esc(model.explain ?? `📋 ${model.summary}`)}</div>`,
      );
    },

    overlay(html) {
      els.overlay.hidden = !html;
      if (keys.overlay !== html) {
        keys.overlay = html;
        els.overlay.innerHTML = html ?? '';
      }
    },
  };
}

const HELP_KEYS = {
  leg: ['move:walk', 'move:run', 'fire:onSight', 'fire:return', 'fire:hold', 'look'],
  arrival: ['cover', 'stance:crouch', 'stance:stand', 'face', 'wait', 'until', 'breach', 'grenade:frag', 'grenade:flash', 'grenade:smoke'],
};
const helpRow = (key) => `<dt>${esc(ACTION_HELP[key][0])}</dt><dd>${esc(ACTION_HELP[key][1])}</dd>`;

const settingsRows = ({ mapName, modeName, modeHelp, timer }) => `
  <div class="setting">${btn('cycleMap', `🗺 ${esc(mapName)} ▸`)}${btn('cycleMode', `🎯 ${esc(modeName)} ▸`)}${btn('cycleTimer', `⏱ ${timer ? `${timer}s to plan` : 'No time limit'} ▸`)}</div>
  <p class="small">${esc(modeHelp)}</p>`;

const ROLE_HELP = [
  'RF Rifleman: all-rounder, one of each grenade',
  'MG Machine gunner: suppresses (slows enemy aim and reactions), poor on the move',
  'SN Sniper: one-shot kills, lightning fast holding an angle, awful moving',
  'BR Breacher: shotgun, 2 flashbangs, breach charges',
  'DM Demolition: 3 frags, smoke, carbine',
]
  .map((l) => `<div>${esc(l)}</div>`)
  .join('');

export const overlays = {
  menu: () => `
    <div class="card">
      <h1>TACTICAL</h1>
      <p>Plan your squad. Confirm. Watch 5 seconds unfold.</p>
      ${btn('start', '⚔ Play vs AI', { arg: 'vsAI', cls: 'go' })}
      ${btn('start', '👁 Watch AI vs AI', { arg: 'aiVsAi' })}
      ${btn('start', '👥 Hotseat (2 players, 1 device)', { arg: 'hotseat' })}
      ${btn('onlineMenu', '🌐 Online (2 players)')}
      ${btn('loadReplay', '📂 Load replay')}
      ${btn('editor', '🛠 Map editor')}
      ${btn('howTo', '❓ How to play')}
      <p class="small">Tap a soldier, tap the map to add waypoints, hold to add a running one.
      Tap a waypoint to edit it, drag it to move it. Pinch / twist / drag to move the camera.</p>
    </div>`,
  /**
   * Match setup: map, game mode and (for human teams) squads.
   * @param teams [{ team, name, squad: [{ role, label, short }] }]
   * @param settings { mapName, modeName, modeHelp }
   */
  squad: (teams, mode, settings) => `
    <div class="card">
      <h2>Match setup</h2>
      ${settingsRows(settings)}
      ${teams.length ? '<p class="small">Tap a slot to change its role. Max 1 sniper and 1 machine gunner.</p>' : ''}
      ${teams
        .map(
          (t) => `<div class="squad team-${t.team}"><b>${esc(t.name)}</b><div class="slots">${t.squad
            .map((r, i) => btn('cycleRole', `<span>${esc(r.short)}</span><small>${esc(r.label)}</small>`, { arg: `${t.team}:${i}`, cls: 'slot' }))
            .join('')}</div></div>`,
        )
        .join('')}
      ${teams.length ? `<div class="roles small">${ROLE_HELP}</div>` : ''}
      ${btn('startMatch', 'Deploy ▶', { arg: mode, cls: 'go' })}
      ${btn('menu', 'Back')}
    </div>`,
  online: (error = '') => `
    <div class="card">
      <h2>Online match</h2>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${btn('onlineCreate', '➕ Create room', { cls: 'go' })}
      <div class="join-row">
        <input id="room-code" maxlength="8" placeholder="ROOM CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        ${btn('onlineJoin', 'Join')}
      </div>
      ${btn('menu', 'Back')}
      <p class="small">Peer-to-peer: both players need internet. The room code is all you share.</p>
    </div>`,
  /** @param squad [{label, short}] | null to hide the picker */
  lobby: ({ code, isHost, connected, ready, squad, team, teamName, settings }) => `
    <div class="card">
      <h2>Room ${esc(code)}</h2>
      <p>You are <b class="t-${team}">${esc(teamName)}</b>${isHost ? ' (host)' : ''}</p>
      ${isHost && !ready ? settingsRows(settings) : ''}
      ${isHost ? `${btn('shareRoom', '🔗 Share invite link')}` : ''}
      <p>${connected ? '✅ Opponent connected' : '⏳ Waiting for opponent…'}</p>
      ${
        ready
          ? `<p>Deployed. ${connected ? 'Waiting for opponent to deploy…' : ''}</p>`
          : `<div class="squad team-${team}"><b>Your squad</b><div class="slots">${squad
              .map((r, i) => btn('cycleRole', `<span>${esc(r.short)}</span><small>${esc(r.label)}</small>`, { arg: `${team}:${i}`, cls: 'slot' }))
              .join('')}</div></div>
             ${btn('onlineReady', 'Deploy ▶', { cls: 'go' })}`
      }
      ${btn('menu', 'Leave')}
    </div>`,
  message: (title, text, actions = btn('menu', 'Main menu')) => `
    <div class="card">
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      ${actions}
    </div>`,
  howTo: (inMatch = false) => `
    <div class="card howto">
      <h2>How to play</h2>
      <p><b>Plan</b> moves for your 4 soldiers, press <b>GO</b>, and both sides' plans play out
      <b>at the same time for 5 seconds</b>. Then you plan again.</p>
      <h3>Planning</h3>
      <ul>
        <li><b>Tap a soldier</b> (or a chip at the bottom) to select it.</li>
        <li><b>Tap the map</b> to add a waypoint, <b>hold</b> to add a running one.</li>
        <li><b>Tap a waypoint</b> to edit it, <b>drag</b> (or hold, then drag) to move it.</li>
        <li>Labels show when each soldier arrives; the white ring is where they'll be when the 5 s end.</li>
        <li>The panel's 📋 line says in words what the selected waypoint will do. Tap any button and that line explains it.</li>
      </ul>
      <h3>Waypoint orders</h3>
      <p class="small">How the soldier gets to the waypoint (they stay in effect until changed):</p>
      <dl class="help">${HELP_KEYS.leg.map(helpRow).join('')}</dl>
      <p class="small">What the soldier does on arrival, one after another, in the order you add them
      (tap a queued one to remove it):</p>
      <dl class="help">${HELP_KEYS.arrival.map(helpRow).join('')}</dl>
      <h3>Fighting</h3>
      <ul>
        <li>Soldiers shoot on their own. <b>Reaction time</b> decides most fights: holding an angle
          (standing still, facing the threat) ≈0.12 s, standing ≈0.3 s, walking ≈0.45 s, running ≈0.8 s.</li>
        <li>Crouching behind low cover makes you harder to hit. Suppressive fire slows aim and reactions.</li>
        <li>Doors block sight. Opening one takes a moment; a <b>breach charge</b> blows it and stuns whoever is behind.</li>
        <li>Flashbangs blind, smoke blocks sight, frags hurt everyone nearby, friends included.</li>
      </ul>
      <h3>Sound</h3>
      <ul>
        <li>Noise goes through walls. Enemies hear <b>running</b> (9 m), <b>opening a door</b> (14 m),
          <b>gunfire</b> (24 m) and <b>breaches</b> (30 m). Walking and crouching are silent.</li>
        <li>When your squad hears an enemy you can't see, a see-through <b>sound ghost</b> marked ? appears
          where the noise came from, with a ripple; it fades over two turns. Idle soldiers turn toward the sound.</li>
        <li>A plain ring marks where an enemy was last <b>seen</b>.</li>
      </ul>
      <h3>Camera</h3>
      <ul><li>Drag to pan, pinch to zoom, twist to rotate. Tap a selected soldier's chip again to centre on them.</li></ul>
      ${inMatch ? btn('closeHelp', 'Back to the game', { cls: 'go' }) : btn('menu', 'Back', { cls: 'go' })}
    </div>`,
  handoff: (teamName) => `
    <div class="card">
      <h2>${esc(teamName)}'s turn to plan</h2>
      <p>Pass the device. The other player shouldn't look!</p>
      ${btn('acceptHandoff', 'Start planning', { cls: 'go' })}
    </div>`,
  over: (title) => `
    <div class="card">
      <h2>${esc(title)}</h2>
      ${btn('rewatch', '⏮ Rewatch match', { cls: 'go' })}
      ${btn('saveReplay', '💾 Save replay')}
      ${btn('menu', 'Main menu')}
    </div>`,
};
