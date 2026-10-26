// Reports a finished match back to the LEGONRUSH host game.
// Delivery, in order of preference:
//  1. Unreal Engine Web Browser binding: window.ue.legonrush.onresult(json)
//  2. Parent window (iframe embedding): postMessage({ type: 'legonrush:result', ...result })
//  3. A 'legonrush:result' CustomEvent on window (tests and same-page hosts)
// Safe to call when running standalone: every channel is optional.
export function reportMatchResult(result) {
  const payload = { type: 'legonrush:result', version: 1, ...result, finishedAt: new Date().toISOString() };
  const json = JSON.stringify(payload);
  try {
    const ue = window.ue && window.ue.legonrush;
    if (ue && typeof ue.onresult === 'function') ue.onresult(json);
  } catch (error) { console.warn('LEGONRUSH bridge (ue) failed', error); }
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*');
  } catch (error) { console.warn('LEGONRUSH bridge (parent) failed', error); }
  try {
    window.dispatchEvent(new CustomEvent('legonrush:result', { detail: payload }));
  } catch (error) { console.warn('LEGONRUSH bridge (event) failed', error); }
  return payload;
}
