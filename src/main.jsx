import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Game from './Game.jsx';
import { activeGamepad, gamepadFamily, readGamepad } from './gamepad.js';
import { DEFAULT_PREFERENCES, KEYBOARD_PRESETS, keyLabel, normalizePreferences, readPreferences, savePreferences } from './preferences.js';
import Landing from './Landing.jsx';
import { DEFAULT_VENUE, VENUES, getVenue, hasVenue } from './venues.js';
import { bookingRules, readDemoBookings, reserveDemoSlot, slotLabel, slotStarts } from './booking.js';
import { abilityForWins, readTeamProgress } from './progression.js';
import { preloadMatchAssets } from './assets.js';
import { TRACKS, createMusic } from './music.js';
import { TEAMS, TEAM_GROUPS, hasTeam, teamShort } from './teams.js';
import { checkForUpdate, versionLabel } from './version.js';
import { setPlayerNames } from './players.js';
import './style.css';

const formations = ['2–2–2', '3–2–1', '2–3–1'];
// Touch-only screens play with touch controls; anything with a mouse or
// trackpad starts on keyboard. Players can still change it before kickoff.
function detectDevice() {
  const media = query => Boolean(window.matchMedia?.(query).matches);
  if (media('(pointer: coarse)') && !media('(any-pointer: fine)'))
    return { device: Math.min(window.screen?.width || 0, window.screen?.height || 0) >= 600 ? 'tablet' : 'phone', inputMode: 'touch' };
  return { device: 'computer', inputMode: 'keyboard' };
}
const music = createMusic({ track: readPreferences().musicTrack });

const initialConfig = { home: 'Commonwealth', away: 'Mensah Sarbah', difficulty: 'Easy', matchMinutes: 5, formation: '2–2–2', ...detectDevice(), venueId: DEFAULT_VENUE, reservation: null };

// Quick Match replays the last kickoff settings on this device.
const LAST_MATCH_KEY = 'legon-football-last-match-v1';
const LAST_MATCH_FIELDS = ['home', 'away', 'difficulty', 'matchMinutes', 'formation', 'venueId'];
function readLastMatch() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_MATCH_KEY) || '{}');
    // Teams that no longer exist (renamed or removed) fall back to the defaults.
    return Object.fromEntries(LAST_MATCH_FIELDS.filter(key => saved[key] !== undefined && (!['home', 'away'].includes(key) || hasTeam(saved[key])))
      .map(key => [key, saved[key]]));
  } catch { return {}; }
}
function saveLastMatch(config) {
  try { localStorage.setItem(LAST_MATCH_KEY, JSON.stringify(Object.fromEntries(LAST_MATCH_FIELDS.map(key => [key, config[key]])))); }
  catch { /* Private browsing may disable local storage. */ }
}

function Logo() { return <img className="logo" src="/images/logo.svg" alt="Legon Football" />; }
function Button({ children, onClick, className = '' }) { return <button className={'btn ' + className} onClick={onClick}>{children}</button>; }
function SiteHeader({ onBack, cred = true }) { return <header className="site-header">{onBack && <Button onClick={onBack}>‹ &nbsp; BACK</Button>}<Logo/><div className="header-spacer"/>{cred && <><span className="cred">DEMO CRED<br/><strong>{readDemoBookings().coins}</strong></span><span className="profile">♟ &nbsp; Campus Player</span></>}</header>; }

function Soon() { return <small className="soon-tag">COMING SOON</small>; }
function Menu({ navigate, venue, campusSelected, quickMatch }) { return <div className="paper menu"><SiteHeader onBack={() => navigate('landing')}/><div className="menu-body"><div className="menu-top"><div><p className="eyebrow">WELCOME TO CAMPUS FOOTBALL</p><h1>MAIN MENU</h1></div><div className="job"><b>TODAY'S JOB</b><span>Win a shootout without missing&nbsp; ➜</span><small>○ ○ ○ ○ ○ ○ ○</small></div><div className="ranking"><small>RANKINGS ↗</small><strong>Join the table</strong><span>Sign in to compete</span></div></div><div className="notice">{campusSelected ? `CAMPUS MATCH · ${venue.name.toUpperCase()}` : "Arrive at a campus football field to begin a match."}<span className="notice-actions"><button type="button" onClick={() => navigate("venues")}>CAMPUS FIELDS</button><button type="button" className="quick" onClick={quickMatch}>QUICK MATCH ▶</button></span></div><div className="menu-grid"><button className="tile main-tile" onClick={() => navigate(campusSelected ? 'types' : 'venues')}><div className="pitch-art"><div className="pitch-mid"/><div className="pitch-circle"/><div className="pitch-spot"/></div><div className="tile-copy"><strong>PLAY MATCH</strong><span>Exhibition against the CPU. Pick your hall, your seven and your shape.</span></div></button><button className="tile soon" disabled><Soon/><em>⚽</em><div className="tile-copy"><strong>PENALTY SHOOTOUT</strong><span>Five kicks each, then sudden death.</span></div></button><button className="tile" onClick={() => navigate(campusSelected ? 'training' : 'venues')}><em>▲</em><div className="tile-copy"><strong>TRAINING</strong><span>Free play and penalty practice.</span></div></button><button className="tile soon" disabled><Soon/><em>VS</em><div className="tile-copy"><strong>TEAM PRO</strong><span>Online team play is awaiting campus backend integration.</span></div></button><button className="tile" onClick={() => navigate('settings')}><em>◧</em><div className="tile-copy"><strong>SETTINGS</strong><span>Keyboard, gamepad and touch controls.</span></div></button></div><div className="watch"><strong>◉ &nbsp; WATCH MATCHES</strong><span>Online viewing awaits multiplayer service</span><button className="btn soon" disabled>COMING SOON</button></div></div><footer className="footer">← → ↑ ↓ &nbsp; Move &nbsp;&nbsp;&nbsp; ↵ &nbsp; Select<span className="footer-version">{versionLabel()}</span></footer></div>; }

function MatchTypes({ navigate }) { return <div className="paper"><SiteHeader onBack={() => navigate('menu')}/><main className="sheet"><p className="eyebrow">MATCH</p><h2>CHOOSE A MATCH TYPE</h2><div className="type-grid"><button onClick={() => navigate('setup')}><b className="watermark">1</b><strong>EXHIBITION</strong><span>One match against the CPU. Any two sides.</span><p>— &nbsp;7 v 7 at your campus field<br/>— &nbsp;Pick difficulty and match length<br/>— &nbsp;Choose your hall side, kits and shape</p></button><button className="soon" disabled><Soon/><b className="watermark">5</b><strong>STADIUM CUP</strong><span>Eight sides, knockout against the CPU. Win three to lift it.</span><p>— &nbsp;Quarter-final to final<br/>— &nbsp;A trophy for the winner</p></button><button className="soon" disabled><Soon/><b className="watermark">2</b><strong>FRIENDLY ONLINE</strong><span>Team Pro will connect through the campus multiplayer service.</span><p>— &nbsp;Up to seven friends per side<br/>— &nbsp;Bots fill open places</p></button></div></main><footer className="footer">← → &nbsp; Move &nbsp;&nbsp; ↵ &nbsp; Select &nbsp;&nbsp; Esc &nbsp; Back</footer></div>; }

function Setup({ config, setConfig, navigate, mode = 'match', stage = 'teams' }) {
  const [city, setCity] = useState('Traditional halls');
  const change = (key, value) => setConfig(current => ({ ...current, [key]: value,
    // Picking the opponent's side as your own hands them another team.
    ...(key === 'home' && current.away === value ? { away: TEAMS.find(team => team.name !== value).name } : {}) }));
  const chooseDevice = device => setConfig(current => ({ ...current, device, inputMode: device === 'computer' ? (current.inputMode === 'gamepad' ? 'gamepad' : 'keyboard') : device === 'phone' ? 'touch' : '' }));
  const venue = getVenue(config.venueId);
  const progress = readTeamProgress(config.home);
  const deviceStep = stage === 'device';
  const nextStep = mode === 'training' ? 'training-device' : 'setup-device';
  const previousStep = mode === 'training' ? 'training' : 'setup';
  return <div className="paper"><SiteHeader onBack={() => navigate(deviceStep ? previousStep : 'types')}/><main className="sheet setup">
    <p className="eyebrow">{mode === 'training' ? 'FREE PLAY' : 'EXHIBITION'} · {deviceStep ? '02 / 02' : '01 / 02'}</p>
    <h2>{deviceStep ? 'DEVICE & KICKOFF' : mode === 'training' ? 'TRAINING SETUP' : 'MATCH SETUP'}</h2>
    {!deviceStep ? <>
      <div className="setup-grid"><section><h3>TEAMS</h3>
        <div className="segmented">{Object.keys(TEAM_GROUPS).map(x => <button className={city === x ? 'selected' : ''} key={x} onClick={() => setCity(x)}>{x}</button>)}</div>
        <div className="select-row"><label>YOUR SIDE<select value={config.home} onChange={e => change('home', e.target.value)}>{Object.entries(TEAM_GROUPS).map(([group, list]) => <optgroup key={group} label={group}>{list.map(team => <option key={team.name} value={team.name}>{team.name}</option>)}</optgroup>)}</select></label><label>OPPONENT<select value={config.away} onChange={e => change('away', e.target.value)}>{Object.entries(TEAM_GROUPS).map(([group, list]) => <optgroup key={group} label={group}>{list.filter(team => team.name !== config.home).map(team => <option key={team.name} value={team.name}>{team.name}</option>)}</optgroup>)}</select></label></div>
        <div className="team-list">{TEAM_GROUPS[city].map(({ name: x, color, note }) => <button key={x} onClick={() => change('home', x)} className={config.home === x ? 'selected' : ''}><span style={{ background: color }}/> {x}{note && <small className="team-note"> · {note}</small>}</button>)}</div>
      </section><section><h3>THE RULES</h3>
        <label>DIFFICULTY<div className="segmented">{['Easy','Medium','Hard'].map(x => <button className={config.difficulty === x ? 'selected' : ''} key={x} onClick={() => change('difficulty', x)}>{x}</button>)}</div></label>
        <label>MATCH LENGTH<div className="segmented">{[5,10,15].map(x => <button className={config.matchMinutes === x ? 'selected' : ''} key={x} onClick={() => change('matchMinutes', x)}>{x} MIN</button>)}</div></label>
        <label>FORMATION<div className="segmented">{formations.map(x => <button className={config.formation === x ? 'selected' : ''} key={x} onClick={() => change('formation', x)}>{x}</button>)}</div></label>
      </section></div>
      <p className="settings-explainer">TEAM DEVELOPMENT · {progress.wins} wins · squad pace, shot power and keeper ability +{Math.round((abilityForWins(progress.wins) - 1) * 100)}%. Completed wins improve your team, up to 20%. Saved on this device.</p>
      <div className="launch"><span>{teamShort(config.home).toUpperCase()} &nbsp; VS &nbsp; {teamShort(config.away).toUpperCase()}</span>{config.device && config.inputMode
        ? <span className="launch-actions"><button className="btn" onClick={() => navigate(nextStep)}>DEVICE · {config.device.toUpperCase()}</button><button className="btn primary" onClick={() => navigate(venue.kind === 'astro' ? 'booking' : 'game')}>{venue.kind === 'astro' ? 'BOOK ASTROTURF ▶' : 'KICK OFF ▶'}</button></span>
        : <button className="btn primary" onClick={() => navigate(nextStep)}>CHOOSE DEVICE ▶</button>}</div>
    </> : <>
      <section className="device-choice"><h3>HOW ARE YOU PLAYING?</h3><p>Choose your device before kickoff.</p>
        <div className="device-options">{[['phone','PHONE','Touch controls · turn sideways'],['tablet','TABLET / IPAD','Choose touch, keyboard or gamepad'],['computer','COMPUTER','Keyboard or gamepad · no on-screen buttons']].map(([value,label,detail]) => <button type="button" key={value} className={config.device === value ? 'selected' : ''} onClick={() => chooseDevice(value)}><strong>{label}</strong><small>{detail}</small></button>)}</div>
        {['tablet','computer'].includes(config.device) && <div className="tablet-input"><span>{config.device.toUpperCase()} INPUT</span><div className="segmented">{(config.device === 'tablet' ? [['touch','TOUCH'],['keyboard','KEYBOARD'],['gamepad','GAMEPAD']] : [['keyboard','KEYBOARD'],['gamepad','GAMEPAD']]).map(([value,label]) => <button type="button" key={value} className={config.inputMode === value ? 'selected' : ''} onClick={() => change('inputMode', value)}>{label}</button>)}</div></div>}
        {config.inputMode === 'gamepad' && <p className="orientation-note">Connect a PlayStation, Xbox or standard PC controller. Keyboard remains available as a fallback.</p>}
      </section>
      <section className="stadium-note"><h3>{venue.name.toUpperCase()}</h3><p>{venue.description} Seven players per side: six outfield and one goalkeeper. Pitch: {venue.length} × {venue.width} m.</p></section>
      <div className="launch"><span>{teamShort(config.home).toUpperCase()} &nbsp; VS &nbsp; {teamShort(config.away).toUpperCase()}</span><button className="btn primary" disabled={!config.device || !config.inputMode} onClick={() => navigate(venue.kind === 'astro' ? 'booking' : 'game')}>{venue.kind === 'astro' ? 'BOOK ASTROTURF ▶' : 'KICK OFF ▶'}</button></div>
    </>}
  </main></div>;
}

// Live check of what the browser can see: every controller, the one in use,
// and the buttons and sticks as they are pressed.
function GamepadTester() {
  const [pads, setPads] = useState([]);
  useEffect(() => {
    let frame;
    const poll = () => {
      const active = activeGamepad();
      setPads(Array.from(navigator.getGamepads?.() || []).filter(Boolean).map(pad => ({
        index: pad.index, id: pad.id, standard: pad.mapping === 'standard', inUse: active?.index === pad.index,
        pressed: pad.buttons.map((b, i) => b.pressed || b.value > 0.35 ? i : -1).filter(i => i >= 0),
        stick: [pad.axes[0] || 0, pad.axes[1] || 0].map(v => v.toFixed(2)).join(', '),
      })));
      frame = requestAnimationFrame(poll);
    };
    poll();
    return () => cancelAnimationFrame(frame);
  }, []);
  if (!pads.length) return <div className="pad-tester"><strong>NO CONTROLLER DETECTED</strong><span>Connect it (USB or Bluetooth), then press any button on it. Browsers only show a controller to a page after one of its buttons is pressed.</span></div>;
  return <div className="pad-tester">{pads.map(pad => <div key={pad.index} className={pad.inUse ? 'in-use' : ''}>
    <strong>{pad.inUse ? '✓ IN USE · ' : ''}{gamepadFamily(pad.id).toUpperCase()} · {pad.standard ? 'STANDARD LAYOUT' : 'GENERIC LAYOUT'}</strong>
    <span>{pad.id}</span>
    <span>Buttons pressed: {pad.pressed.length ? pad.pressed.join(', ') : 'none'} · Left stick: {pad.stick}</span>
  </div>)}</div>;
}

function Settings({ navigate, camera, setCamera, preferences, setPreferences }) {
  const [tab, setTab] = useState('Keyboard');
  const [capture, setCapture] = useState('');
  const [notice, setNotice] = useState('');
  const keyboardRows = [['up','MOVE UP'],['down','MOVE DOWN'],['left','MOVE LEFT'],['right','MOVE RIGHT'],['pass','SHORT PASS'],['through','THROUGH BALL'],['shoot','HOLD TO SHOOT'],['lob','LOB / CROSS'],['sprint','SPRINT'],['switch','SWITCH PLAYER / RUN'],['shield','PROTECT BALL'],['finesse','FINESSE MODIFIER'],['slide','SLIDE TACKLE'],['tackle','STANDING TACKLE'],['keeperRush','RUSH GOALKEEPER'],['teammate','TEAMMATE CONTAIN'],['jockey','JOCKEY'],['skill','SKILL MOVE']];
  const gamepadRows = [['cross','✕ / A · PASS · CONTAIN'],['circle','◯ / B · LOB, CROSS · SLIDE TACKLE'],['square','▢ / X · SHOOT · TACKLE'],['triangle','△ / Y · THROUGH BALL · KEEPER RUSH'],['l1','L1 / LB · STRAFE, CHIP · CHANGE PLAYER'],['r1','R1 / RB · SPRINT · TEAMMATE CONTAIN'],['l2','L2 / LT · SHIELD · JOCKEY'],['r2','R2 / RT · CONTROLLED SPRINT, FINESSE · SPRINT'],['l3','L3 · PLAYER LOCK (WITH R3)'],['r3','R3 · CONTROL GOALKEEPER'],['pause','PAUSE / OPTIONS / MENU']];
  const buttonNames = ['✕ / A','○ / B','□ / X','△ / Y','L1 / LB','R1 / RB','L2 / LT','R2 / RT','SELECT','OPTIONS / MENU','LEFT STICK','RIGHT STICK','DPAD UP','DPAD DOWN','DPAD LEFT','DPAD RIGHT','HOME'];
  const update = patch => setPreferences(previous => normalizePreferences({ ...previous, ...patch }));
  const setKeyboard = (action, key) => {
    const next = key.toLowerCase();
    if (['escape','tab','enter','meta','alt'].includes(next)) { setNotice('Choose a gameplay key. Escape remains Pause / Back.'); return; }
    const movement = ['up','down','left','right'];
    const conflict = Object.entries(preferences.keyboard).find(([name, value]) => value === next && movement.includes(name) !== movement.includes(action));
    if (conflict) { setNotice(`${keyLabel(next)} is already used for ${conflict[0].toUpperCase()} movement. Choose another key or change preset.`); return; }
    const context = ['slide','tackle','keeperRush','teammate','jockey'].includes(action) ? 'defense' : movement.includes(action) ? 'movement' : 'attack';
    const sameContext = name => context === 'defense' ? ['slide','tackle','keeperRush','teammate','jockey'].includes(name) : context === 'movement' ? movement.includes(name) : !movement.includes(name) && !['slide','tackle','keeperRush','teammate','jockey'].includes(name);
    const occupied = Object.entries(preferences.keyboard).find(([name, value]) => name !== action && sameContext(name) && value === next)?.[0];
    const keyboard = { ...preferences.keyboard, [action]: next };
    if (occupied) keyboard[occupied] = preferences.keyboard[action];
    update({ keyboard });
    setCapture(''); setNotice(`${action.toUpperCase()} set to ${keyLabel(next)}.`);
  };
  const setGamepad = (action, button) => {
    const gamepad = { ...preferences.gamepad };
    const occupied = Object.keys(gamepad).find(name => name !== action && gamepad[name] === button);
    if (occupied) gamepad[occupied] = gamepad[action];
    gamepad[action] = button;
    update({ gamepad });
  };
  const touchPosition = (part, value) => update({ touch: { ...preferences.touch, [part]: value, [part === 'joystick' ? 'actions' : 'joystick']: value === preferences.touch[part === 'joystick' ? 'actions' : 'joystick'] ? (value === 'left' ? 'right' : 'left') : preferences.touch[part === 'joystick' ? 'actions' : 'joystick'] } });
  return <div className="paper"><SiteHeader onBack={() => navigate('menu')}/><main className="sheet settings-page"><p className="eyebrow">OPTIONS</p><h2>SETTINGS</h2><p className="version-line">{versionLabel()}</p>
    <div className="segmented settings-tabs">{['Keyboard','Gamepad','Touch','HUD','Camera'].map(name => <button key={name} className={tab === name ? 'selected' : ''} onClick={() => { setTab(name); setNotice(''); setCapture(''); }}>{name}</button>)}</div>
    {tab === 'Keyboard' && <><div className="settings-head"><h3>KEYBOARD CONTROLS</h3><div className="segmented">{[['classic','CLASSIC · ARROWS'],['wasd','WASD · JIKL']].map(([value,label]) => <button key={value} className={preferences.keyboardPreset === value ? 'selected' : ''} onClick={() => { update({ keyboardPreset: value, keyboard: { ...KEYBOARD_PRESETS[value] } }); setNotice(''); }}>{label}</button>)}</div></div><p className="settings-explainer">Classic uses arrow movement so S/W/D/A can control the ball. Click a key, then press its replacement; occupied keys swap.</p><div className="settings-list settings-remap">{keyboardRows.map(([action,label]) => <div key={action}><span>{label}</span><button className={capture === action ? 'capturing' : ''} onClick={() => { setCapture(action); setNotice('Press a key to assign it.'); }} onKeyDown={event => { if (capture !== action) return; event.preventDefault(); event.stopPropagation(); setKeyboard(action, event.key); }}>{capture === action ? 'PRESS KEY…' : keyLabel(preferences.keyboard[action])}</button></div>)}</div>{notice && <p className="settings-feedback" role="status">{notice}</p>}</>}
    {tab === 'Gamepad' && <><div className="settings-head"><h3>GAMEPAD BUTTONS</h3><button className="btn" onClick={() => update({ gamepad: { ...DEFAULT_PREFERENCES.gamepad } })}>RESET BUTTONS</button></div><GamepadTester/><p className="settings-explainer">EA FC classic layout: each button does one thing when attacking and another when defending. Combos: R2 + ▢ finesse, L1 + ▢ chip, L1 + R1 + ▢ power shot, R1 + ▢ hard tackle, L2 + R2 sprint jockey, L3 + R3 player lock. Right stick: skill move, or flick to switch player. Left stick always moves. Occupied buttons swap.</p><div className="settings-list settings-remap">{gamepadRows.map(([action,label]) => <div key={action}><span>{label}</span><select aria-label={`${label} button`} value={preferences.gamepad[action]} onChange={event => setGamepad(action, Number(event.target.value))}>{buttonNames.map((name,index) => <option key={index} value={index}>{name}</option>)}</select></div>)}</div></>}
    {tab === 'Touch' && <><h3>LANDSCAPE TOUCH</h3><p className="settings-explainer">The five controls stay the same: move, pass, hold to shoot, sprint and switch. Move the joystick and action group to suit your hands.</p><div className="settings-options"><label>MOVE JOYSTICK<div className="segmented">{['left','center','right'].map(value => <button key={value} className={preferences.touch.joystick === value ? 'selected' : ''} onClick={() => touchPosition('joystick',value)}>{value.toUpperCase()}</button>)}</div></label><label>ACTION BUTTONS<div className="segmented">{['left','center','right'].map(value => <button key={value} className={preferences.touch.actions === value ? 'selected' : ''} onClick={() => touchPosition('actions',value)}>{value.toUpperCase()}</button>)}</div></label><label>BUTTON SIZE <strong>{Math.round(preferences.touch.size * 100)}%</strong><input type="range" min="0.75" max="1.25" step="0.05" value={preferences.touch.size} onChange={event => update({ touch: { ...preferences.touch, size: Number(event.target.value) } })}/></label><label>BUTTON OPACITY <strong>{Math.round(preferences.touch.opacity * 100)}%</strong><input type="range" min="0.08" max="1" step="0.01" value={preferences.touch.opacity} onChange={event => update({ touch: { ...preferences.touch, opacity: Number(event.target.value) } })}/></label></div></>}
    {tab === 'HUD' && <><h3>ON-SCREEN MATCH DISPLAY</h3><p className="settings-explainer">Choose what stays visible while you play.</p><div className="settings-list settings-hud">{[['player','CONTROLLED PLAYER LABEL'],['radar','PITCH RADAR'],['hints','CONTROL HINTS'],['score','SCOREBOARD'],['messages','MATCH MESSAGES'],['sound','MATCH SOUND'],['commentary','COMMENTARY']].map(([key,label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={preferences.hud[key]} onChange={event => update({ hud: { ...preferences.hud, [key]: event.target.checked } })}/></label>)}</div><h3>MENU MUSIC</h3><p className="settings-explainer">Plays on the menus and fades out at kickoff.</p><div className="segmented">{['amapiano', 'anthem'].map(id => <button key={id} className={preferences.musicTrack === id ? 'selected' : ''} onClick={() => update({ musicTrack: id, hud: { ...preferences.hud, music: true } })}>{TRACKS[id].title.toUpperCase()}</button>)}<button className={!preferences.hud.music ? 'selected' : ''} onClick={() => update({ hud: { ...preferences.hud, music: false } })}>OFF</button></div></>}
    {tab === 'Camera' && <><h3>CHOOSE CAMERA</h3><div className="segmented camera-select">{['Co-op','Wide','Behind player'].map(name => <button key={name} className={camera === name ? 'selected' : ''} onClick={() => setCamera(name)}>{name}</button>)}</div><p>Co-op follows the ball carrier from a lower side view. Wide shows more of the field. Behind player follows from your team's end.</p></>}
  </main></div>;
}

function CampusFields({ navigate, onArrival }) {
  return <div className="paper campus-page"><SiteHeader onBack={() => navigate('menu')}/><main className="sheet campus-sheet"><p className="eyebrow">UNIVERSITY OF GHANA · FOOTBALL LOCATIONS</p><h2>CAMPUS FIELDS</h2><p>Preview the walk or ride arrival points. In the university game, the player’s current location sends the field ID automatically.</p><div className="venue-grid">{VENUES.map(venue => <button type="button" key={venue.id} className={`venue-card surface-${venue.surface} kind-${venue.kind}`} onClick={() => onArrival(venue.id)}><span className="venue-card-art"><span className="venue-pitch"/></span><span className="venue-card-copy"><small>{venue.reference} · {venue.length} × {venue.width} m</small><strong>{venue.name}</strong><span>{venue.description}</span><em>ARRIVE AT THIS FIELD ›</em></span></button>)}</div></main></div>;
}

function Booking({ config, setConfig, navigate }) {
  const [data, setData] = useState(() => readDemoBookings());
  const [chosen, setChosen] = useState(() => slotStarts()[0]);
  const [error, setError] = useState('');
  const slots = slotStarts();
  const booked = side => data.reservations.some(item => item.start === chosen && item.side === side);
  const [side, setSide] = useState('A');
  const other = data.reservations.find(item => item.start === chosen && item.side !== side);
  const reserve = () => {
    try {
      const result = reserveDemoSlot(chosen, side, config.home);
      setData(readDemoBookings());
      setConfig(previous => ({ ...previous, reservation: result.reservation, away: other?.team || previous.away, matchMinutes: bookingRules.slotMinutes }));
      navigate('game');
    } catch (cause) {
      setError(cause.message);
      setData(readDemoBookings());
    }
  };
  useEffect(() => {
    const refresh = () => setData(readDemoBookings());
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  return <div className="paper"><SiteHeader onBack={() => navigate('setup-device')}/><main className="sheet booking-page"><p className="eyebrow">PRESEC ASTROTURF · SESSION DESK</p><h2>BOOK YOUR PITCH</h2><p>Astroturf play uses a {bookingRules.slotMinutes}-minute session. Each opening has one place for each seven-player team. If no opposing team arrives, bots take their places.</p><div className="booking-layout"><section><h3>CHOOSE AN OPENING</h3><div className="booking-slots">{slots.map(start => <button type="button" className={chosen === start ? 'selected' : ''} key={start} onClick={() => { setChosen(start); setError(''); }}>{slotLabel(start)}<small>{data.reservations.filter(item => item.start === start).length}/2 TEAMS</small></button>)}</div></section><section><h3>YOUR TEAM</h3><p><strong>{config.home}</strong> · six outfield players + one goalkeeper</p><div className="segmented">{['A','B'].map(value => <button type="button" className={side === value ? 'selected' : ''} key={value} onClick={() => { setSide(value); setError(''); }}>SIDE {value}{booked(value) ? ' · TAKEN' : ' · OPEN'}</button>)}</div><p>{other ? `${other.team} has the other place.` : 'No opponent booked yet. An NPC team will fill the vacancy.'}</p><p>Session price: <strong>{bookingRules.priceCoins} demo coins</strong> · balance: {data.coins}</p><p className="booking-disclaimer">Standalone preview: reservations and demo coins are saved on this device. Shared availability and real coin payment require the campus game’s booking service.</p>{error && <p className="booking-error" role="alert">{error}</p>}<button type="button" className="btn primary" disabled={booked(side) || data.coins < bookingRules.priceCoins} onClick={reserve}>RESERVE & PLAY ▶</button></section></div></main></div>;
}

function ArrivalPrompt({ venue, onAccept, onDecline }) {
  return <div className="arrival-screen"><div className="arrival-card" role="dialog" aria-modal="true" aria-labelledby="arrival-title"><p className="eyebrow">CAMPUS FOOTBALL</p><h1 id="arrival-title">YOU'VE ARRIVED AT {venue.name.toUpperCase()}</h1><p>{venue.description}</p><div className="arrival-meta"><span>{venue.length} × {venue.width} m</span><span>{venue.surface.toUpperCase()} SURFACE</span></div><p>Do you want to play football here?</p><div className="arrival-actions"><button className="btn primary" onClick={onAccept}>YES · OPEN FOOTBALL ▶</button><button className="btn" onClick={onDecline}>NOT NOW</button></div></div></div>;
}

const requestedVenueId = new URLSearchParams(window.location.search).get('venue');

function viewportSize() {
  return { width: Math.max(1, window.visualViewport?.width || window.innerWidth), height: Math.max(1, window.visualViewport?.height || window.innerHeight) };
}

function usePortraitViewport() {
  const [portrait, setPortrait] = useState(() => { const { width, height } = viewportSize(); return height > width; });
  useEffect(() => {
    const update = () => { const { width, height } = viewportSize(); setPortrait(height > width); };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);
  return portrait;
}

function ViewportFrame({ children, page }) {
  const content = useRef(null);
  const [layout, setLayout] = useState({ width: 1024, scale: 1, left: 0, top: 0 });
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { width, height } = viewportSize();
        const baseWidth = width;
        element.style.width = `${baseWidth}px`;
        const naturalWidth = Math.max(baseWidth, element.scrollWidth);
        const naturalHeight = Math.max(1, element.scrollHeight);
        const scale = Math.min(1, width / naturalWidth, height / naturalHeight);
        setLayout({ width: baseWidth, scale, left: (width - naturalWidth * scale) / 2, top: (height - naturalHeight * scale) / 2 });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [page]);
  return <div className={`viewport-stage viewport-${page}`}><div ref={content} className="viewport-content" style={{ width: layout.width, left: layout.left, top: layout.top, transform: `scale(${layout.scale})` }}>{children}</div></div>;
}

function OrientationGate() {
  return <div className="orientation-gate" role="dialog" aria-modal="true" aria-labelledby="orientation-title"><div className="orientation-card"><div className="orientation-illustration" aria-hidden="true"><span className="phone-portrait"><i/></span><span className="rotate-arrow">↻</span><span className="phone-landscape"><i/></span></div><p className="eyebrow">READY FOR KICKOFF</p><h1 id="orientation-title">ROTATE TO LANDSCAPE</h1><p>Turn your phone or tablet sideways so the pitch and every control fit on screen. On a computer, widen your browser window.</p><strong>THE GAME OPENS AUTOMATICALLY WHEN YOUR SCREEN IS WIDE.</strong></div></div>;
}

function App() {
  const [page, setPage] = useState('landing');
  const [preferences, setPreferences] = useState(readPreferences);
  const [config, setConfig] = useState(initialConfig);
  const [camera, setCamera] = useState('Co-op');
  const [arrivalVenueId, setArrivalVenueId] = useState(hasVenue(requestedVenueId) ? requestedVenueId : null);
  const [campusSelected, setCampusSelected] = useState(false);
  const portrait = usePortraitViewport();
  useEffect(() => savePreferences(preferences), [preferences]);
  const navigate = useCallback((nextPage, nextArrival = null) => {
    if (portrait && nextPage !== 'landing') {
      if (nextArrival) setArrivalVenueId(nextArrival);
      return;
    }
    window.history.pushState({ legonFootball: { page: nextPage, arrivalVenueId: nextArrival } }, '', window.location.href);
    setArrivalVenueId(nextArrival);
    setPage(nextPage);
  }, [portrait]);
  useEffect(() => {
    const existing = window.history.state?.legonFootball;
    if (existing) {
      setPage(existing.page || 'landing');
      setArrivalVenueId(existing.arrivalVenueId || null);
    } else {
      const initialArrival = hasVenue(requestedVenueId) ? requestedVenueId : null;
      window.history.replaceState({ legonFootball: { page: 'landing', arrivalVenueId: null, root: true } }, '', window.location.href);
      window.history.pushState({ legonFootball: { page: 'landing', arrivalVenueId: initialArrival } }, '', window.location.href);
    }
    const onPopState = event => {
      const target = event.state?.legonFootball;
      if (!target || target.root) {
        window.history.pushState({ legonFootball: { page: 'landing', arrivalVenueId: null } }, '', window.location.href);
        setPage('landing'); setArrivalVenueId(null);
        return;
      }
      setPage(target.page || 'landing');
      setArrivalVenueId(target.arrivalVenueId || null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const arriveAtVenue = id => {
    if (!hasVenue(id)) return;
    navigate('menu', id);
  };
  const acceptArrival = () => {
    setConfig(previous => ({ ...previous, venueId: arrivalVenueId, reservation: null }));
    setCampusSelected(true);
    navigate('setup');
  };
  const quickMatch = () => {
    const venueId = campusSelected ? config.venueId : readLastMatch().venueId || config.venueId;
    const next = { ...config, ...readLastMatch(), ...detectDevice(), venueId: hasVenue(venueId) ? venueId : DEFAULT_VENUE, reservation: null };
    setConfig(next); setCampusSelected(true);
    navigate(getVenue(next.venueId).kind === 'astro' ? 'booking' : 'game');
  };
  useEffect(() => { if (page === 'game') saveLastMatch(config); }, [page, config]);
  // Menu music: off during matches (the crowd takes over). Browsers only allow
  // sound after a click or key press, so it starts on the first one.
  useEffect(() => { music.setTrack(preferences.musicTrack); }, [preferences.musicTrack]);
  // Check for a newer published build every minute and on returning to the tab.
  const [update, setUpdate] = useState(null);
  const padHeld = useRef({ confirm: true, back: true }); // treat buttons as held until seen released
  useEffect(() => {
    let stopped = false;
    const check = () => checkForUpdate().then(live => { if (live && !stopped) setUpdate(live); });
    const first = setTimeout(check, 5000), timer = setInterval(check, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  // Never interrupt a match: the banner waits for the menus.
  const updateBanner = update && page !== 'game' && <div className="update-banner" role="status"><div><strong>NEW UPDATE AVAILABLE</strong><span>{versionLabel(update)}</span></div><button className="btn primary" onClick={() => window.location.reload()}>UPDATE NOW ▶</button></div>;
  useEffect(() => {
    const wanted = page !== 'game' && preferences.hud.music;
    if (!wanted) { music.stop(); return; }
    const start = () => music.play();
    if (navigator.userActivation?.hasBeenActive) start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    return () => { window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
  }, [page, preferences.hud.music]);
  // Fetch the players, moves and stadium while people are still in the menus.
  useEffect(() => { if (page !== 'landing' && page !== 'game') preloadMatchAssets(config.venueId); }, [page, config.venueId]);
  useEffect(() => {
    const handleMessage = event => {
      if (event.source !== window.parent) return;
      // The campus game can name its players: { type: 'monkeypost:players', solo, home, away }.
      if (event.data?.type === 'monkeypost:players') { setPlayerNames(event.data); return; }
      if (event.data?.type !== 'monkeypost:arrive') return;
      if (hasVenue(event.data.venueId)) navigate('menu', event.data.venueId);
    };
    window.addEventListener('message', handleMessage);
    window.MonkeyPostCampus = { arriveAtVenue: id => { if (hasVenue(id)) navigate('menu', id); }, setPlayerNames };
    return () => {
      window.removeEventListener('message', handleMessage);
      delete window.MonkeyPostCampus;
    };
  }, [navigate]);
  useEffect(() => {
    const handleEscape = event => {
      if (event.key !== 'Escape' || page === 'game' || portrait) return;
      window.history.back();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [page, portrait]);
  useEffect(() => {
    if (page === 'game') return;
    // A button still held from the previous screen must not press this one too,
    // so the held state carries over between pages.
    let frame, previous = padHeld.current, nextMove = 0;
    const poll = () => {
      const pad = activeGamepad();
      const input = readGamepad(pad, preferences.gamepad);
      if (input) {
        const buttons = Array.from(document.querySelectorAll('button:not(:disabled)')).filter(button => button.getClientRects().length);
        const focused = document.activeElement;
        const vertical = (pad.buttons?.[13]?.pressed || input.z > 0.6 ? 1 : 0) - (pad.buttons?.[12]?.pressed || input.z < -0.6 ? 1 : 0);
        const horizontal = (pad.buttons?.[15]?.pressed || input.x > 0.6 ? 1 : 0) - (pad.buttons?.[14]?.pressed || input.x < -0.6 ? 1 : 0);
        const step = vertical || horizontal;
        if (step && performance.now() >= nextMove && buttons.length) {
          const current = buttons.indexOf(focused);
          buttons[(current + step + buttons.length) % buttons.length].focus();
          nextMove = performance.now() + 220;
        }
        if (input.actions.cross && !previous.confirm) {
          const target = buttons.includes(document.activeElement) ? document.activeElement : buttons.find(button => button.classList.contains('primary') || button.classList.contains('main-tile')) || buttons[0];
          target?.click();
        }
        if (input.actions.circle && !previous.back && !portrait) window.history.back();
        previous = { confirm: input.actions.cross, back: input.actions.circle };
      } else previous = { confirm: false, back: false };
      padHeld.current = previous;
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [page, portrait, preferences.gamepad]);

  if (page === 'game' && !arrivalVenueId) return <><Game key={config.venueId + config.home + config.away + config.formation} config={config} cameraMode={camera} preferences={preferences} exit={() => navigate('menu')} orientationBlocked={portrait}/>{portrait && <OrientationGate/>}</>;
  if (portrait) return <>{updateBanner}<ViewportFrame page="landing"><Landing enter={() => {}} explore={() => {}} venue={campusSelected ? getVenue(config.venueId) : null}/></ViewportFrame><OrientationGate/></>;
  let screen;
  if (arrivalVenueId) screen = <ArrivalPrompt venue={getVenue(arrivalVenueId)} onAccept={acceptArrival} onDecline={() => window.history.back()}/>;
  else if (page === 'landing') screen = <Landing enter={() => navigate('menu')} explore={() => navigate('venues')} quick={quickMatch} venue={campusSelected ? getVenue(config.venueId) : null}/>;
  else if (page === 'menu') screen = <Menu navigate={navigate} venue={getVenue(config.venueId)} campusSelected={campusSelected} quickMatch={quickMatch}/>;
  else if (page === 'venues') screen = <CampusFields navigate={navigate} onArrival={arriveAtVenue}/>;
  else if (page === 'types') screen = <MatchTypes navigate={navigate}/>;
  else if (['setup', 'training', 'setup-device', 'training-device'].includes(page)) screen = <Setup config={config} setConfig={setConfig} navigate={navigate} mode={page.startsWith('training') ? 'training' : 'match'} stage={page.endsWith('device') ? 'device' : 'teams'}/>;
  else if (page === 'booking') screen = <Booking config={config} setConfig={setConfig} navigate={navigate}/>;
  else if (page === 'settings') screen = <Settings navigate={navigate} camera={camera} setCamera={setCamera} preferences={preferences} setPreferences={setPreferences}/>;
  else screen = <div className="paper"><SiteHeader onBack={() => window.history.back()}/><main className="sheet"><p className="eyebrow">LEGON FOOTBALL</p><h2>{page.toUpperCase()}</h2><p>This mode is being rebuilt. The exhibition match is playable now.</p><Button className="primary" onClick={() => navigate(campusSelected ? 'setup' : 'venues')}>PLAY EXHIBITION ▶</Button></main></div>;
  return <>{updateBanner}<ViewportFrame page={arrivalVenueId ? 'arrival' : page}>{screen}</ViewportFrame></>;
}

createRoot(document.getElementById('root')).render(<App/>);
