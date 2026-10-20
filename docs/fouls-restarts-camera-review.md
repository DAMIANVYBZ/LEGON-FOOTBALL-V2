# Fouls, restart execution and camera review

## Reproduced problems

- In 40 seeded standing-tackle fixtures, 17 clean exposed-ball pokes became
  fouls merely because the defender was behind the carrier. The ball was at
  x=1 m, carrier at x=1.6 m facing +x and tackler at x=0: the ball was reached
  before the body. The old rule rolled a 45% foul chance.
- A human free-kick short pass launched with approximately 12.33 m/s upward
  velocity. It targeted the goal reticle and used the airborne launch solver.
- A short pass aimed backward could hit its own taker, since the run-up still
  approached along the original goal-facing reticle.
- Close free kicks projected the taker's feet below the viewport (phone NDC
  y about -1.86). A subsequent corner could retain a previous restart's camera
  pose and put the taker outside the viewport.
- The old restart view lingered for 1.2 seconds after delivery and then cut
  abruptly back to play. Open-play camera focus and phone zoom also switched
  abruptly in some paths.
- Camera projection checks initially missed invisible avatars: at far-side
  Astroturf and stadium corners, the selection marker was visible but the
  skinned character was culled using cached animation bounds.

## Changes

`src/challenges.js` judges the route to the ball, proximity/body contact and
approach velocity. Clean ball-first challenges do not become random fouls;
shielded balls cannot be won through the body. A reckless body-first slide can
still warrant a red card. The same 40 clean-poke fixtures now produce zero
fouls. This is a controlled fixture result, not a claim of a zero match foul
rate. CPU standing pokes reposition/jockey if the body blocks the ball instead
of starting a tackle animation and rolling a foul.

`src/camera.js` fits the taker, ball, aim point and relevant goal frame into
explicit view margins. Every new restart has its own view, including goal
kicks, throw-ins, long free kicks and indirect free kicks. The chosen open-play
mode returns with exponential position/focus damping, without the old delayed
hard cut; phone zoom eases too. Open-play look height responds to high balls.
Default phone controls remain visible; the radar is hidden during restart
framing to keep the central ball/taker area clear.

Skinned player meshes are excluded from frustum culling to avoid incorrect
cached animated bounds. There are fourteen players; the scenery still uses
normal culling. Actual rendered Astroturf and stadium near/far corner images
confirm visible player models, not just visible selection markers.

Free-kick, indirect-free-kick, corner and goal-kick short passes now target a
nearby teammate and use ground-pass speeds with a small launch lift. Their
preview is a ground line. The target is committed on release; run-ups align
with the actual delivery and can curve around the ball for a backward pass.
A teammate offers a short option. Goal kicks use aim, charge and run-up controls.

Human run-ups respect restart readiness, including the penalty preparation
period. A passed penalty is tapped forward. Moving the taker uses the stored
run-up start, so a delayed strike does not place them far outside the intended
run-up. Reckless-contact and penalty/indirect-restart rules remain active.

## Validation

- `npm test`: 72 unit tests, including clean/exposed-ball challenges,
  body-first reckless contact, stationary-defender cases and fitted camera
  projections in both directions, both touchlines and portrait/landscape.
- `python tools/audit_restarts_camera.py`: 72 camera framings (three modes,
  two devices, two teams, six restart types), sixteen foul/delivery groups and
  four release-transition replays. It also includes consecutive-corner checks
  without a match reset; those were verified separately during this iteration.
- `python tools/check_camera_venues.py`: captures 56 restart placements across
  eight venues. Corner cases also inspect the rendered default red kit near the
  projected taker to catch invisible models that numerical framing misses.
- `python tools/check_phone_camera.py`: retains the 25% phone magnification,
  touchline coverage and paused-rendering checks. It now waits for the restart
  lens to settle before requiring zoom=1 instead of demanding an instant snap.
- `python tools/audit_first_half.py --venue sarbah`: seventeen gameplay groups
  and a fresh first-half playthrough. The former assertion demanding a red for
  a clean ball-first slide is now a no-red assertion; the new reckless-slide
  browser fixture separately verifies a foul and red card.
- `python tools/audit_rules.py`: the eight-venue rules regression also passed
  during this iteration. Its exempt goal-kick fixture now waits for the actual
  aim/run-up delivery rather than inspecting the ball before it was struck.
- Full-match `smoke_match.py` and production desktop/phone `smoke_physics.py
  --production` pass, including keeper distribution, crossing, halftime,
  fulltime, saved wins, controls and absence of the debug API.
- `npm run build` succeeds with the existing large-chunk warning.

The camera evidence uses Chromium with software WebGL. Most replay checks use
fixed simulation steps with actual rendered frames; these establish framing,
state transitions and delivery behaviour, not physical-phone frame rates. A
short real-time diagnostic was limited to very few frames by software rendering
under concurrent load, so it is not evidence of device-level smoothness.
Geometry/contact rules still use body proxies, not a full articulated contact
or referee simulation. Keep the broader differences recorded in
[the rules/physics audit](gameplay-rules-and-physics-audit.md).

## Evidence

Artifacts are under `/workspace/playtest-artifacts/fouls-camera-before/`,
`fouls-camera-audit/` and `camera-venues/`. `freeKick-before-after.png` and
`corner-before-after.png` show the camera changes directly. Avatar visibility
captures and JSON are in the same audit folder; `switch-results.json` records
consecutive near/far corners for both teams on desktop and phone. Changes are
local and have not been committed, pushed or deployed.
