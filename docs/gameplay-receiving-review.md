# Gameplay iteration: pass reception

## Reference comparison

Reviewed Google Research Football's native controller source, especially
`third_party/gfootball_engine/src/onthepitch/player/controller/elizacontroller.cpp`,
`ElizaController::_GetPassingOdds`: it predicts a receiver's position using
movement and a bounded time allowance for braking. Its movement and touch
commands are separate systems, unlike this game's immediate possession flags.
This is a source comparison; the native Google game was not built or played.
No Google source was copied or translated in this iteration.

Our passing code already leads moving teammates. The immediate problems were
in approaching the receiving point and deciding when possession is granted:

- A receiver requested full sprint speed until less than 0.5 m from the target,
  then stopped requesting movement. In an isolated 8.1 m/s approach to a point
  3 m ahead, it stopped at 4.064 m: 1.064 m beyond the target. Hysteresis could
  then leave it standing beyond the desired receiving point.
- The final home reception path checked distance and height but bypassed the
  speed limit and post-kick control lock used earlier in the simulation.

## Changes

Receiving movement now reduces desired speed according to distance, with a
braking limit and a slower final approach. Other supporting runs keep their
existing movement behaviour. The numerical example stops at 2.923 m.

Both home reception paths now require the same horizontal reach, height and
ball-speed checks; the final path also respects the control lock, opposition
possession, restarts and sent-off status. Away pass recipients use the same
reach, height and speed criteria. Loose-ball recovery rules remain separate.

## Validation

- Unit regression covers the braking approach at 30, 60 and 120 Hz, plus
  rejection of high, distant and excessively fast balls.
- `python tools/smoke_physics.py` includes actual 5 m, 12 m and 24 m passes,
  asserting receiver selection, eventual possession and control transfer.
- `python tools/smoke_match.py` exercises tackling, both keepers, distribution,
  passing, crossing, halftime, fulltime and progression.
- `npm test` and `npm run build` cover regressions and production compilation.

These changes address pass reception, not general gameplay parity with Google.
Physical first-touch deflections, timed dribble touches, animation/contact
synchronisation and broader team tactics remain candidates for later iterations.
