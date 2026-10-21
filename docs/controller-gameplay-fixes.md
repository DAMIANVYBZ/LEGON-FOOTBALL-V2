# Controller and gameplay corrections — 21 October 2026

## Behavior changes

- Pause, halftime and full-time dialogs accept left-stick/D-pad selection and
  Cross/A confirmation, including Second Half, Leave Match and Main Menu.
  The focused button has an explicit outline. Circle/B resumes an ordinary
  pause; at period end it focuses Leave Match instead of silently dismissing
  the result. Confirmation does not leak into a pass on the pitch.
- Ground passes charge on press and kick on release. Up to 1.2 seconds of charge
  controls nominal speed (8–26 m/s) and target range (7–42 m). Short holds favour
  nearer aligned receivers, longer holds favour farther receivers. Receiver
  assistance no longer overwrites charged speed with a fixed minimum. Existing
  keeper distribution and set-piece charging retain their own controls.
- R1 full sprint, R2 controlled sprint and ordinary movement have distinct speeds.
  Cached gamepad holds are reapplied after a pause/blur; R1 does not remain stuck
  off when it was held throughout the menu. Sprint remains subject to stamina.
- Slides take their direction from the current left stick, or a nearby ball if
  the stick is neutral, rather than stale facing. The lunge begins after a
  0.42-second windup; challenge/knockdown checks cannot occur until 0.58 seconds.
  The ball must be within reach and the body must be close enough for a victim
  to fall. A clean ball poke does not knock over a distant opponent.
- Low-force ordinary contact no longer meets the standing-foul threshold.
  Forceful body-first challenges still earn fouls/cards. The existing ball-first
  route and shielding checks remain in use.
- A right-stick skill lasts 1.25 seconds, eases through one turn, and has a
  cooldown. The clip's baked root yaw is removed so the authored turn does not
  double the physical turn. Controlled ball correction follows the feet-facing
  dribble point with bounded travel; opponent contacts can still release it.
- Physical boundary exits remain visible for 0.85 seconds before relocating the
  ball for a restart, with a Ball Out message. Last touch and the first fully
  crossed boundary still determine the recipient/type. The closer camera also
  follows lofted balls vertically instead of looking at the ground beneath them.
- Player animations now tick with fixed simulation steps. On a slow render frame,
  an animation cannot race ahead of the physics/contact clock and stand up early.

## Verification

86 unit tests and the production build pass. In Chromium, the new controller
replay exercises the real gamepad reader with a virtual standard controller:
normal/R2/R1 speeds, held R1 after pause, charged passes on release, directed
slides with delayed falls, a complete connected spin, visible boundary exits,
and gamepad navigation/confirmation at halftime and full time.

Measured controlled fixtures: ordinary/R2/R1 dribble speeds 4.70/5.97/7.14 m/s;
pass holds of 0.08/0.60/1.15 seconds launch at 9.25/17.00/25.25 m/s. The spin's
maximum ball-to-player gap is 0.68 m and maximum per-tick correction is 0.082 m.
After an intentional 600 ms browser stall, the animation and simulation both
advance 0.20 seconds. One slide fixture holds its opposing carrier stationary
using the development motion lock: the opponent remains upright on press and
through windup, then falls only after contact. This is a controlled reproduction,
not proof that a slide will catch every moving opponent.

Existing checks pass: 17 gameplay groups, 6 boundary groups, 10 rule groups and
8 foul/restart groups at Sarbah; full-match browser checks include keepers,
passing/control transfer, headers, halftime/fulltime and saved-win progression.
Production desktop and landscape phone checks cover movement, pass and pause
controls and the absence of the development API. Physical controllers and real
phone performance have not been independently tested here.

Artifacts: `/workspace/playtest-artifacts/controller-fixes/results.json`,
`legacy-results.json` and `halftime-gamepad-focus.png`.
Run `python tools/audit_controller_fixes.py` against Vite to replay the focused
controller checks. Old browser fixtures now charge intended longer passes and
allow the documented visible-exit delay before checking the restart placement.

## Publishing and browser access

The user retains Netlify. Publishing is through GitHub main and its connected
Netlify build. A push does not verify Netlify publication; direct Netlify access
is blocked in this session. The available browser runs automated tests and
screenshots, with no interactive in-chat browser panel to hand to the user.
