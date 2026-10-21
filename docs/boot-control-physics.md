# Ball control and grounded dribbling — 2026-10-21

This update extends the close-control work already on main through abfdd86.
It retains the newer pass momentum, temporary striker-capsule exclusion and
central goal-kick formation. Ground alignment was already corrected upstream.
The remaining carry code still overwrote ball position after physics and set
its velocity equal to the player. Replace that with foot-driven touches so the
ball rolls independently between them.

Changes:

- Replace the per-frame position overwrite with velocity changes at grounded
  animated toe contacts. Rapier handles travel, rolling resistance, spin and
  collisions between touches. Brief first-touch assistance steers a nearby ball
  through bounded velocity; it does not move its position or fix its height.
- Use the actual dribble clip's boots to gate touches. Jog and sprint contacts
  have separate cadence. A small two-joint leg reach supports braking and turns
  while preserving leg lengths and the boot's world orientation. Momentum is
  checked at a reachable boot, including when reversing direction.
- Start released passes and normal kicks at the contact portion of their clip,
  retaining the follow-through. A full-power ground shot uses a standing kick
  rather than an aerial scissor clip. Keep charged passes, aimed shots, chips and
  set-piece run-ups.
- Buffer a kick for up to 0.35 s when it arrives just before a short recovery
  lock ends or the ball enters reach. Kick reach uses horizontal distance and
  playable height. Pause, blur, cancellation, expiry, restarts and a change of
  controlled player or opponent touch discard queued input. Opponent possession
  still uses tackles.
- Retain fallback grass at physical y=0 and measure imported baked grass to align
  it to that same plane instead of assuming a fixed 3 cm offset. Keep the
  existing phone camera zoom.
- Reset repositioned physical player bodies along with the ball at kickoffs and
  deterministic scenarios. This prevents their placement from producing a huge
  artificial kinematic collision velocity.

Validation and limits:

The focused browser replay measures maximum ball/player gaps of about 0.48 m
jogging and 0.67 m sprinting, with stops, right-angle turns and reversals below
0.56 m in the isolated fixtures. The ground ball stays within 3 mm of its 0.11 m
radius. Its velocity and lead vary between touches; neither is welded to the
carrier. Single-release passes/shots across a short lock, cancelled and expired
commands, and the goal-kick run-up are exercised in the actual match loop.

The existing physics replay checks 5/12/24 m passes, first touches from behind
and above, body deflections for both teams, CPU shot height and lofted crosses.
A raised reception keeps a natural first bounce and is allowed 1.2 s to settle;
the previous 0.6 s expectation relied on forced ball height. A quick goal kick
was investigated and already schedules its 1.4 s setup/run-up correctly; that
was not an additional lost-input defect.

Development stepping now advances animation with every fixed physics step,
matching production. Remove the extra animation advance from older replay
scripts. The diagnostic API is stripped from production builds. The active-team
moving-pass fixture measures travel from the strike, since a short pass can hit
a nearby receiver while the original passer continues running. It still rejects
recapture; nine isolated movement/charge cases also require separation from the
runner for a full second. The halftime replay has extra time allowance for
visible out-of-play stoppages and stops before the second half.


Verified: 99 unit tests; 136 event groups and first-half completion in all eight
venues; 80 rules groups across the same venues; stationary, directional and
moving pass regressions; human/CPU goal-kick positioning; controller charging,
slides, spin and halftime navigation; and 5/12/24 m receptions. The production
build passes desktop keyboard and emulated landscape-phone joystick, multitouch,
pass and pause checks, with no debug API or JavaScript errors. Final first-half
results: /workspace/ball-control-audit/final-venues/audit.json. Earlier transport
and replay-time-budget failures were rerun successfully on the merged code.

These are automated Chromium software-rendered replays and inspected rendered
screenshots, not physical-phone performance measurements or a claim of PES-level
animation fidelity. Replay commands:

```sh
npm test -- --test-isolation=none
python tools/audit_boot_control.py
python tools/audit_ball_control.py
python tools/audit_pass_release.py
python tools/audit_moving_pass.py
python tools/audit_goal_kick_shape.py
python tools/smoke_physics.py
python tools/audit_first_half.py --output /workspace/ball-control-audit/venues
python tools/audit_controller_fixes.py --first-half
python tools/audit_rules.py
npm run build
npm run deploy:check
```


## Sprint recovery follow-up — 2026-10-21

The user reported sometimes running ahead of the ball while sprinting. The
previous revision failed 29 of 84 transition fixtures varying initial ball lead,
jog duration and the direction chosen as sprint starts. A from-rest sprint alone
did not cover these stride phases. A slow touch could be overtaken before the
normal 0.3 s sprint contact interval; a ball trapped behind a nearly stationary
player could also be left there by the next step.

Changes: allow an earlier, reachable catch-up touch and give it enough forward
pace for the next stride; coordinate the carrier's wanted speed with ball travel
through the existing acceleration bounds; take a bounded lateral recovery step
for wide touches; and keep the dribble step active during slow recovery. Fast
and controlled sprint use their actual control intent and stamina eligibility.
These movement adjustments apply only while carrying a reachable ground ball.
Released passes and normal off-ball running keep their existing movement and
physics. Ball position and height are never rewritten by this recovery.

Verification: 103 unit tests pass. The new tools/audit_sprint_control.py runs 116
controller cases on each of Sarbah, Astro and Oval (348 total), covering R1/R2,
stride phases, initial touches from behind, angles, fatigue and repeated bursts.
Every case retains control, keeps the ball grounded and rejects sustained lag
behind the runner. Maximum ball/player gaps are 0.792 m, 0.904 m and 0.760 m
respectively. The existing distinct sprint-speed, controller, moving keyboard/
gamepad/three-finger touch passes, boot-control and physics replays pass.

Replay with Vite running: `python tools/audit_sprint_control.py`. Results and
baseline reproductions are in /workspace/sprint-control-audit/.

The active-team Sarbah first-half replay also completes with all 17 event groups
passing. Production desktop keyboard and emulated landscape-phone joystick,
multitouch, passing and pause checks pass with no JavaScript errors. Build and
Cloudflare static-asset packaging dry run pass.
