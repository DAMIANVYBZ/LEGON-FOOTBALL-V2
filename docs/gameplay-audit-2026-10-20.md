# Gameplay audit — 20 October 2026

The requested scope is first-half play, movement/physics corrections, a further
25% phone zoom, and a record of every change. Browser-controlled replays use
the actual rendered game and match simulation. Event fixtures are deterministic;
the cross-venue first halves use accelerated simulation. No second half is
entered during this audit. This is not a physical-device performance test.

## Changes and the evidence behind them

| Change | Reproduced problem | Correction and replay |
| --- | --- | --- |
| Phone zoom | Players were too small in landscape play. | Normal phone cameras use `zoom = 1.25`. Tablet/computer zoom remains 1. Set-piece close-ups retain zoom 1 to preserve the original over-the-shoulder view. Projection measurements compare identical kickoff views. |
| Far-touchline phone framing | After zooming, a player near the far touchline projected behind the scoreboard: head at normalized screen y≈0.95, about 9 px from the top of a 390 px display. | The phone broadcast camera tilts towards far-side play while retaining the same lens zoom. Camera checks assert that the head clears the scoreboard and near-side play remains in the frame. |
| Keeper vertical reach | A ball at 5 m height was parried by a keeper standing under it. The match replay recorded a save and changed the ball velocity. | `saveOutcome` rejects balls above the keeper's vertical reach. A pure regression test and the same high-ball browser fixture check both the decision and match behavior. Ordinary catches and high punches remain covered. |
| Physical last touch | A torso deflection reversed a shot from +20 m/s to about −2.14 m/s, but `lastTouchHome` still identified the shooter. | Rapier collision-start events report the player who deflected a loose ball. Match logic uses that touch for restart ownership. Owner sensors and held/carried balls do not create false changes of possession. |
| Resolved slide tackle | A seeded slide from behind awarded a red card but left `sliding` true. | End the lunge as soon as its initial challenge is decided. A player sent off does not receive another slide recovery state. Browser checks retain the seeded red-card assertion. |
| Pause/focus input cleanup | Shot charge remained at about 0.417 after focus was lost; pending actions and some controller holds were not part of the old cleanup. | Pause/resume and blur clear movement, held modes, charge and queued shots. A set-piece charge returns to aiming. The event audit checks input state after blur. |
| Paused rendering | The full scene, shadows and camera were redrawn every animation frame behind an unchanged pause overlay. | Reuse the last picture while paused. Resize, pause transitions and debug replays request a fresh render. Inputs remain polled; running play still renders normally. Camera checks compare rendered frame counts while paused. |
| Slow-frame quality adjustment | A normal-speed replay on this host's software renderer ran far below real time. Quality adjustment was receiving a delta capped at 0.25 s, so on very slow frames its waiting periods took much longer than the documented real seconds. | Use uncapped frame time for quality decisions while retaining the physics catch-up cap. Start phones with a 1024² shadow map instead of 2048², reducing the shadow-map pixel count by 75%; desktop/tablet retain 2048². Software rendering is not a phone hardware benchmark. |

No dependency or large asset was added. The existing controls, commentary,
hall groups, booking preview, update banner and production/debug separation
are retained.

## Event coverage

`tools/audit_first_half.py` visits all eight venues, including the astroturf
booking flow. Each event audit exercises jogging, sprinting, braking, reversing,
passing/control transfer, through passes, normal/low/finesse/power shots,
lofted crosses, standing/sliding tackles, a red card, keeper catches and
distribution, unreachable high balls, physical deflections, throw-ins, both
teams' corners/free kicks/goal kicks/penalties, goals/net response and input
cleanup. It then starts a separate match and stops at the first HALF TIME.

Raw JSON reports and screenshots are saved outside the checkout under
`/workspace/playtest-artifacts/`. They include the original phone view and
the updated view. An early audit run was interrupted after competing software
renderers caused browser timeouts; final results must come from the sequential
rerun after the paused-rendering correction.

The final sequential run completed all eight first halves with **136/136 event
groups passing and no JavaScript errors**:

| Venue | Event groups | Reached HALF TIME |
| --- | --- | --- |
| Mensah Sarbah | 17/17 | Yes |
| Gonja Park | 17/17 | Yes |
| Nania Main | 17/17 | Yes |
| Nania North | 17/17 | Yes |
| Nania East | 17/17 | Yes |
| Presec Astroturf | 17/17 | Yes, after booking |
| Athletic Oval | 17/17 | Yes |
| UG Stadium | 17/17 | Yes |

Camera measurements at the same kickoff were 23.93 px on phone versus 19.14 px
on tablet/computer, a ratio of exactly 1.25. After the far-side framing fix the
player's head projects around 127 px down the 390 px display, clear of the
scoreboard. Paused-view measurements allow at most one pending redraw; the
unchanged view then stops rendering.

The test additions include `audit_first_half.py`, `check_phone_camera.py`, a
`--first-half` option on the existing match smoke test, a queued-shot cleanup
case, and collision-owner/keeper-height regression assertions. Development-only
camera, movement and input diagnostics support repeatable replays; the production
build removes them with the existing debug API.

The extra normal-speed software-rendered run was interrupted when it could not
keep up with real time; it is not recorded as a completed normal-speed first
half. This led to the quality-clock and phone-shadow corrections above. The
camera check injects a 600 ms frame stall and verifies that quality timing
receives at least 500 ms, while the simulation retains its catch-up limit.
The measured quality delta was approximately 613 ms; all three device profiles
recorded zero idle redraws over the paused sampling interval.
The completed eight first halves are accelerated browser replays; real-phone
performance remains unmeasured.

After the final quality corrections, the eight-venue replay again passed all
136 event groups and stopped at halftime in every match. The focused physics
smoke test and `smoke_match.py --first-half` passed with no JavaScript errors;
the latter also verified catches, punches, wide diving saves and that no team
win is saved at halftime. All 48 unit tests passed. The production build passed
with the existing bundle-size warning. The production desktop/touch smoke test
passed against the exact generated build ID, including keyboard/joystick movement,
passing, pause/resume, version metadata and absence of the development debug API.

## Reproduce

With the development server running:

```sh
npm test -- --test-isolation=none
python tools/smoke_match.py --first-half
python tools/smoke_physics.py
python tools/check_phone_camera.py
python tools/audit_first_half.py --output /workspace/playtest-artifacts/final
# Optional normal-speed first-half playthrough:
python tools/audit_first_half.py --venue sarbah --realtime --output /workspace/playtest-artifacts/realtime
```

The explicit Node isolation option is used in this sandbox so the individual
test outcomes and counts are visible; the suite contains 48 tests after the
keeper regression is added. Browser scripts require Python Playwright and
Chromium.

Build and check the production game:

```sh
npm run build
npm run preview -- --port 4173 --strictPort
# In another terminal:
FOOTBALL_BASE_URL=http://127.0.0.1:4173 python tools/smoke_physics.py --production
```

## Publishing

The previous commit, `51007d9`, was created locally but its push to `main`
was rejected by GitHub with HTTP 403. This audit must be committed and the
push retried. Do not treat a local commit or production preview as a successful
GitHub push or Netlify deployment. Confirm the remote commit and deployed
`version.json` when access permits.

## Remaining limits

This does not establish parity with a commercial football game. Real phone
frame rate, thermal behavior, controller feel and subjective animation quality
still need hardware playtesting. Online play, shared booking/payment services,
offside and the disabled shootout/cup features are not implemented by this audit.
