// Stable button identities keep the joystick/sprint held across possession changes.
export function touchActions(attacking = true, keeperHolding = false) {
  return [
    { id: 'context', key: keeperHolding ? 'q' : attacking ? 'h' : 'touchSwitch', label: keeperHolding ? 'PUT DOWN' : attacking ? 'JOCKEY' : 'SWITCH', className: 'switch' },
    { id: 'circle', key: attacking ? 'k' : 'u', label: attacking ? 'SHOOT' : 'SLIDE', symbol: '○', className: 'circle' },
    { id: 'cross', key: attacking ? 'j' : 'touchTackle', label: attacking ? 'PASS' : 'TACKLE', symbol: '×', className: 'cross' },
    { id: 'sprint', key: 'shift', label: 'SPRINT', className: 'sprint' },
  ];
}
