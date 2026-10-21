/**
 * DOM overlay. Buttons carry data-action / data-arg; clicks are delegated to
 * onAction(action, arg). Each section only re-renders when its content key changes.
 */
const ICON = { stance: { crouch: '▼ Crouch', stand: '▲ Stand' }, face: '➜ Face', wait: '⏱ Wait', grenade: '💣 Grenade' };

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const btn = (action, label, { arg = '', cls = '', title = '', disabled = false } = {}) =>
  `<button data-action="${action}" data-arg="${esc(arg)}" class="${cls}" title="${esc(title)}" ${disabled ? 'disabled' : ''}>${label}</button>`;

export function actionLabel(a) {
  if (a.type === 'stance') return ICON.stance[a.stance];
  if (a.type === 'wait') return `${ICON.wait} ${a.t}s`;
  return ICON[a.type] ?? a.type;
}

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
    },

    hint(text) {
      els.hint.hidden = !text;
      if (els.hint.textContent !== text) els.hint.textContent = text;
    },

    buttons({ paused, speed, showCones, showPlans, logOpen, inMatch }) {
      set(
        'buttons',
        JSON.stringify(arguments[0]),
        inMatch
          ? btn('togglePause', paused ? '▶' : '⏸', { title: 'Play / pause' }) +
              btn('cycleSpeed', `${speed}×`, { title: 'Playback speed' }) +
              btn('toggleCones', '👁', { cls: showCones ? 'on' : '', title: 'Vision cones' }) +
              btn('togglePlans', '⤳', { cls: showPlans ? 'on' : '', title: 'Show plans' }) +
              btn('toggleLog', '☰', { cls: logOpen ? 'on' : '', title: 'Event log' }) +
              btn('resetCamera', '⌖', { title: 'Reset camera' }) +
              btn('fullscreen', '⛶', { title: 'Fullscreen' }) +
              btn('menu', '✕', { title: 'Quit to menu' })
          : btn('fullscreen', '⛶', { title: 'Fullscreen' }),
      );
    },

    log(lines, open) {
      els.log.hidden = !open || !lines.length;
      set('log', JSON.stringify(lines), lines.map((l) => `<div class="${l.cls ?? ''}">${esc(l.text)}</div>`).join(''));
    },

    timeline({ visible, cursor, max, label, live }) {
      els.timeline.hidden = !visible;
      if (!visible) return;
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
      if (model.kind === 'continue') {
        return set('bar', JSON.stringify(model), btn('continue', 'Plan next turn ▶', { cls: 'go' }));
      }
      const chips = model.soldiers
        .map((s) =>
          btn('select', `<b>${esc(s.num)}</b><i style="--hp:${s.hp}%"></i>${s.wps ? `<small>${s.wps}</small>` : ''}`, {
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
      if (model.kind === 'soldier') {
        return set(
          'panel',
          JSON.stringify(model),
          `<div class="row info">${esc(model.label)} · HP ${model.hp} · 💣 ${model.grenades} · ${model.wps} waypoint${model.wps === 1 ? '' : 's'}</div>
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
           ${btn('move', '🚶 Walk', { arg: 'walk', cls: w.move === 'walk' ? 'on' : '' })}${btn('move', '🏃 Run', { arg: 'run', cls: w.move === 'run' ? 'on' : '' })}
           <span class="sep"></span>
           ${btn('fire', '🎯 Fire at will', { arg: 'onSight', cls: w.fire === 'onSight' ? 'on' : '' })}${btn('fire', '🤫 Hold fire', { arg: 'hold', cls: w.fire === 'hold' ? 'on' : '' })}
         </div>
         <div class="row">
           ${btn('addStance', '▼ Crouch', { arg: 'crouch' })}${btn('addStance', '▲ Stand', { arg: 'stand' })}
           ${btn('pick', '➜ Face…', { arg: 'face', cls: model.pickMode === 'face' ? 'on' : '' })}
           ${btn('addWait', '⏱ +1s')}
           ${btn('pick', '💣 Grenade…', { arg: 'grenade', cls: model.pickMode === 'grenade' ? 'on' : '', disabled: model.grenades <= 0 })}
           ${btn('pick', '👁 Look while moving…', { arg: 'look', cls: model.pickMode === 'look' ? 'on' : '' })}
           ${btn('deleteWaypoint', '🗑', { cls: 'danger', title: 'Delete waypoint' })}
         </div>
         ${actions || w.look ? `<div class="row actions">${w.look ? btn('clearLook', '👁 Look ✕', { cls: 'action' }) : ''}${actions}</div>` : ''}`,
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

export const overlays = {
  menu: () => `
    <div class="card">
      <h1>TACTICAL</h1>
      <p>Plan your squad. Confirm. Watch 5 seconds unfold.</p>
      ${btn('start', '⚔ Play vs AI', { arg: 'vsAI', cls: 'go' })}
      ${btn('start', '👁 Watch AI vs AI', { arg: 'aiVsAi' })}
      ${btn('start', '👥 Hotseat (2 players, 1 device)', { arg: 'hotseat' })}
      <p class="small">Tap a soldier, tap the map to add waypoints, hold to add a running one.
      Tap a waypoint to edit it, drag it to move it. Pinch / twist / drag to move the camera.</p>
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
      ${btn('menu', 'Main menu')}
    </div>`,
};
