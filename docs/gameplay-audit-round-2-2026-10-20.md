# Continued gameplay audit — 20 October 2026

This pass continues from deployed commit `c727712`. The user authorized further
playtesting, fixes, commits and deployment. Existing physics and camera work is
documented in [the first audit](gameplay-audit-2026-10-20.md).

## Corrections

1. **Premature throws and goal-line restarts.** At Sarbah, a stationary ball
   whose centre was 4 cm beyond the touchline immediately became a throw-in.
   The same 4 cm overlap outside a goal post produced a goal kick. The ball has
   an 11 cm radius, so it was still touching the line. All pitch boundaries now
   wait for the whole ball to cross. Both directions and both teams are checked.
2. **Two restarts for one diagonal exit.** The old boundary routine processed
   a throw-in, changed last-touch ownership, then processed a goal-line restart
   in the same step. Near a corner this could award a corner instead of a goal
   kick. The game now compares the two crossing times and awards exactly one
   restart at the first line crossed. Throws are placed at that crossing point.
   Goal-mouth decisions also use the crossing point rather than a later point
   in the ball's flight.
3. **Unreachable balls near the lines.** A controlled player running toward a
   ball at Sarbah's touchline stopped at z=20.5 m while the ball remained at
   z=22.1 m. The player could neither control it nor reach it by running. The
   2 m sideline and 1.5 m end-line movement barriers are removed for outfielders;
   a small 40 cm run-off allowance lets them play the ball on the line. Ball
   crossings still stop play. Replays check retrieval at all four pitch edges.
4. **Human input affected the opponent keeper's distribution.** The shared
   keeper target function read the human's direction for either keeper, and
   its aimed pass search always selected home players. In the catch/distribute
   replay, human movement changed the away keeper's release from a ground roll
   to a throw toward the human side. The CPU keeper now uses his own team's
   passing choices; human aim remains available for the human keeper. A fixed
   scenario checks that four different human inputs all select away teammate 12.
5. **Cancelled phone touches fired shots.** Charging SHOOT and sending a real
   Chromium `touchCancel` event released a shot at about 26.4 m/s horizontally.
   Cancellation and lost capture now cancel the charge instead of striking.
   The same handling cancels a charged keeper throw, lob or set piece. Normal
   finger release still shoots; a cancelled free kick returns to aiming.
6. **Phone control state survived interruptions.** The engine previously
   cleared input on pause/blur while touch components retained their captured
   pointer and held/joystick appearance. Components now clear their local state
   too, accept a fresh gesture after blur, and disable gameplay touches while
   paused, loading or blocked by orientation. A different finger cannot release
   the first finger's held button or joystick.

No new engine, copied third-party code or dependency was added. The requested
25% phone camera magnification remains in place.

## Validation

- Node regression suite: 50 tests passed, zero failed or skipped, including
  whole-ball crossings and first-boundary ownership for diagonal exits.
- All 88 boundary, retrieval, keeper and phone-input check groups passed across
  all eight venues, with no JavaScript errors.
- All 136 existing match-event groups passed, and all eight accelerated first
  halves reached halftime paused. One Nania North run was interrupted by a Vite
  reload during the final input-guard edit; that venue was replayed cleanly.
  The original interrupted run and its successful rerun are retained separately
  in the exported evidence. The final combined result counts each venue once.
- Physics smoke: manual shot direction, defender-aware passing, CPU shot height,
  lofted crosses and focus-loss shot cancellation passed.
- First-half match smoke: tackles/counterattacks, both keepers, catch and
  distribution, punches, dives, keyboard passing/control transfer, crosses and
  halftime with no prematurely recorded win passed.
- Camera smoke: phone player size remained exactly 1.25 times the tablet size;
  desktop/tablet zoom, set-piece views and paused rendering passed. Additional
  camera checks at z=−22 m and z=22 m confirmed newly reachable touchline play
  stays framed. The existing shadow-map and slow-frame checks also passed.
- Production build passed, retaining the existing large-chunk warning. The
  exact local build passed desktop keyboard movement, pause/resume, version
  metadata, phone joystick movement, two-finger ownership, touch passing and
  phone pause controls, with no JavaScript errors or production debug API.

Useful commands with Vite running:

```sh
npm test -- --test-isolation=none
python tools/audit_match_edges.py
python tools/audit_first_half.py --output /workspace/playtest-round2/first-halves
python tools/smoke_physics.py
python tools/smoke_match.py --first-half
python tools/check_phone_camera.py
```

`audit_match_edges.py` exercises the actual development match loop and sends
Chromium touch events to the actual phone controls. Existing first-half replays
use accelerated match simulation and rendered screenshots; they do not measure
normal-speed play or physical-phone performance.

The production smoke check now reads version metadata through browser `fetch`,
as the game does. Playwright's separate request client failed DNS resolution in
the cloud even when the browser successfully opened the live game. This was a
test-harness networking issue, not a game failure.

A preliminary multitouch smoke command ended the original finger instead of
the second finger. Native pointer-event tracing identified that test error;
the corrected second-finger release checks passed in the built game. It did
not require another gameplay change.

The live phone pass check initially ran after the longer multitouch sequence,
when the CPU could already have taken possession. It now checks the pass just
after kickoff movement, while the player still has the ball, before testing
multitouch ownership. This preserves the pass assertion without assuming that
possession survives an unrelated sequence of gestures.

## Publication

The previous `c727712` deployment was confirmed by the live site's version file.
This follow-up is published only after its validation completes; its commit and
live version are reported in the chat and exported audit summary.
