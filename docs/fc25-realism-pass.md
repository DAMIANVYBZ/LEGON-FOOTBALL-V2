# FC 25 realism pass

This pass targets the gaps found in a code audit of the match engine against EA SPORTS FC 25
("FIFA 25"). It changes how players move, how shots are struck and missed, how the CPU defends
and attacks, and how tackles and touches are decided. Every tunable lives in a config file
(`src/movementConfig.js`, `src/physicsConfig.js`, `src/attributes.js`).

## What changed

| Area | Before | Now | Where |
|---|---|---|---|
| Acceleration | 19-24 m/s^2: full sprint in ~0.35 s | Acceleration fades as speed rises: ~1 s to 6.1 m/s, ~1.7 s to full sprint | `MOVEMENT` in `movementConfig.js`, `advancePlayer` in `gameplay.js` |
| Turning | Flat 8-12 rad/s; 180 degrees in a third of a second at full pace | Sideways-acceleration budget: a sprinting player has a ~6 m turning circle and loses speed cutting | `advancePlayer` |
| Player identity | Every player identical; one team multiplier | Ten attributes per player (pace, acceleration, agility, strength, dribbling, passing, finishing, tackling, stamina, handling), by position, stable per hall | new `src/attributes.js` |
| Team multiplier | Win progression gave up to +20% speed to all players | Progression still raises ability, but its effect on running speed is cut to 30% (max +6%) | `run()` in `Game.jsx` |
| Difficulty | CPU speed x0.9 / 1 / 1.04 | Speed ~1; difficulty is player quality, number of pressers, shot range, accuracy, reaction | `DIFFICULTY` in `physicsConfig.js` |
| Stamina | Empty stamina cost 10% speed | 18% speed, drain/recovery scaled by the stamina attribute | `STAMINA` |
| Shot assist | Aim within ~6 m of a post was pulled inside the frame | Assist reaches ~3 m past the post; error grows with distance, pressure and a weak finisher; shots go wide and over | `aimShot` in `shooting.js` |
| CPU shots | Always the far corner, always on target | Far corner, near corner or placed central; error depends on difficulty, distance, pressure; occasional long-range efforts | `shotTarget`, `decideCarrier` in `cpuBrain.js` |
| CPU defence | Two players press; the rest drift on a formula, nobody marks | Difficulty-based number of pressers (2/3/3); everyone else marks a nearby attacker goal-side while you have the ball | `Game.jsx` (CPU movement block) |
| CPU attack | Run at goal; never pass sideways unless pressed | Recycles to a free teammate when a defender is closing in; passes carry attribute-based error | `decideCarrier`, `cpuPlay` |
| Tackles | Geometry only; ball always rolled to a fixed direction | Geometry makes a tackle possible, tackling/strength vs dribbling/strength decides it; a beaten tackler stumbles and the ball can pop loose; the ball runs away from the challenge | `tackleChance` in `attributes.js`, CPU and teammate tackles in `Game.jsx` |
| Touches | Perfect cadence at any skill | A weak dribbler sometimes takes a heavy touch at pace | `footTouch` in `ballControl.js` |
| Keepers | Same handling for all | Reach scaled by the keeper's handling attribute | `updateKeeper` |

## Not changed by this pass

These audit findings still stand. They are larger projects than a tuning pass.

- **11v11 and full-size pitches.** The game is 10v10 (7v7 at Presec) on 75% scale pitches with
  full-size goals. Moving to 11v11 touches formations, kickoff roles, goal-kick shapes, roster tests and
  every venue; the scenery for the park venues is approximate. Scale the goals with the pitch at the same time.
- **Body physics.** Players can still overlap and there are no strength-based shoulder duels for the human
  player's tackles (they remain deterministic by design).
- **Animation-synced touches** and a larger motion library (still the supplied 29 clips).
- **Missing mechanics:** first-time shots/passes, volleys, trivelas, one-twos, dummies, substitutions,
  extra time, penalty shootout, advantage, handball, ends swapping at halftime, bigger free-kick walls.
- **Team tactics:** dynamic formations, defensive line height, roles and mentality.

## Verification

- Pure-logic tests pass (`npm test`), including `tests/fc25Realism.test.js` and updated movement tests.
- Tests that need Rapier or three.js could not be run where this change was made (no network to install
  them); they need `npm install`. Run `npm test`, then the browser audits in `tools/` and play every venue.
- `Game.jsx` passes a syntax and undefined-name check, but the match loop was **not** run in a browser here.
  Play-test sprinting, tackling, CPU pressing and shooting before shipping, and tune from the config files.

## Tuning quick reference

- Faster or slower build-up: `MOVEMENT.accel.*`; turning circle: `MOVEMENT.lateral.*`.
- How different players feel: factor ranges in `src/attributes.js` (e.g. `paceFactor`), or team `quality`.
- Miss rate: `margin` and `spread` in `aimShot`; CPU: `shotTarget` and `DIFFICULTY.*.accuracy`.
- CPU pressure: `DIFFICULTY.*.pressers`, `pressDistance`; marking radius in the CPU movement block.
- Tackle success: `tackleChance` weights.
