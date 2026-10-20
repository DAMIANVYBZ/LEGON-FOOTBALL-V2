import React, { useEffect, useRef, useState } from 'react';

const BUTTONS = [
  { key: 'q', label: 'SWITCH', className: 'switch' },
  { key: 'k', label: 'SHOOT', symbol: '○', className: 'circle' },
  { key: 'j', label: 'PASS', symbol: '×', className: 'cross' },
  { key: 'shift', label: 'SPRINT', className: 'sprint' },
];

function ActionButton({ input, engine, disabled }) {
  const [held, setHeld] = useState(false);
  const pointer = useRef(null);
  const release = (event, cancelled = false) => {
    if (pointer.current === null || event.pointerId !== pointer.current) return;
    pointer.current = null;
    setHeld(false);
    if (cancelled) engine.current?.cancel(input.key);
    else engine.current?.release(input.key);
  };
  useEffect(() => {
    const cancel = () => {
      pointer.current = null; setHeld(false); engine.current?.cancel(input.key);
    };
    if (disabled) cancel();
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); cancel(); };
  }, [disabled, engine, input.key]);
  return <button
    type="button"
    disabled={disabled}
    aria-label={input.label.toLowerCase()}
    className={`action-button ${input.className}${held ? ' held' : ''}`}
    onPointerDown={event => {
      event.preventDefault();
      if (disabled || pointer.current !== null) return;
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setHeld(true);
      engine.current?.press(input.key);
    }}
    onPointerUp={event => release(event)}
    onPointerCancel={event => release(event, true)}
    onLostPointerCapture={event => release(event, true)}
    onClick={event => {
      if (disabled || event.detail !== 0) return;
      engine.current?.press(input.key);
      engine.current?.release(input.key);
    }}
  >{input.symbol ? <><span className="action-symbol">{input.symbol}</span><small>{input.label}</small></> : input.label}</button>;
}

export default function TouchControls({ engine, settings, disabled = false }) {
  const stickPointer = useRef(null);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const reset = () => { stickPointer.current = null; setStick({ x: 0, y: 0 }); engine.current?.setAxis(0, 0); };
    if (disabled) reset();
    window.addEventListener('blur', reset);
    return () => { window.removeEventListener('blur', reset); reset(); };
  }, [disabled, engine]);
  const moveStick = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = rect.width * 0.36;
    const dx = (event.clientX - rect.left - rect.width / 2) / radius;
    const dy = (event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.max(1, Math.hypot(dx, dy));
    const x = dx / length, y = dy / length;
    setStick({ x, y });
    engine.current?.setAxis(x, y);
  };
  const releaseStick = event => {
    if (stickPointer.current === null || event.pointerId !== stickPointer.current) return;
    stickPointer.current = null;
    setStick({ x: 0, y: 0 });
    engine.current?.setAxis(0, 0);
  };
  return <div className={`virtual-controls touch-stick-${settings.joystick} touch-actions-${settings.actions}`} style={{ '--touch-size': settings.size, '--touch-opacity': settings.opacity }} aria-label="On-screen player controls">
    <button type="button" className="touch-pause" disabled={disabled} onClick={() => engine.current?.togglePause()}>Ⅱ PAUSE</button>
    <div className="joystick-wrap">
      <div
        className="joystick"
        role="application"
        aria-label="Move player joystick"
        aria-disabled={disabled}
        onPointerDown={event => {
          event.preventDefault();
          if (disabled || stickPointer.current !== null) return;
          stickPointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          moveStick(event);
        }}
        onPointerMove={event => { if (!disabled && stickPointer.current === event.pointerId) moveStick(event); }}
        onPointerUp={releaseStick}
        onPointerCancel={releaseStick}
        onLostPointerCapture={releaseStick}
      >
        <span className="joystick-axis horizontal"/><span className="joystick-axis vertical"/>
        <span className="joystick-knob" style={{ transform: `translate(${stick.x * 36}px, ${stick.y * 36}px)` }}/>
      </div>
      <span>MOVE</span>
    </div>
    <div className="action-pad" aria-label="Player actions">
      {BUTTONS.map(input => <ActionButton key={input.key} input={input} engine={engine} disabled={disabled}/>)}
    </div>
  </div>;
}
