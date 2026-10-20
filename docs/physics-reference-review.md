# Football physics: reference review and first upgrade

## Sources reviewed

Relevant source trees were downloaded into `/workspace/football-references/`,
outside the game checkout. They are reference material, not runtime dependencies
or additional game assets. Licenses remain alongside those checkouts.

| Project | Reviewed commit | Relevant source and decision |
| --- | --- | --- |
| [Google Research Football](https://github.com/google-research/football) | `3d9e754720a95621bba6475c4d3b0d56fe919014` | `third_party/gfootball_engine/src/onthepitch/ball.cpp`: separate flight, surface response and spin; cached predictions. Keep the existing drag/Magnus model and make ground contact exchange travel and spin. Apache-2.0. |
| [FreeKick 3](https://github.com/anttisalonen/freekick3) | `baac95a345b498d14664cb567ba382de680b0d2c` | `src/match/Ball.cpp`, `src/match/ai/`: distinct airborne/rolling behavior, receiving and keeper states. The native engine is not a browser replacement. GPLv3+; no source copied into this game. |
| [RoboCup Soccer Simulator](https://github.com/rcsoccersim/rcssserver) | `ce870013f2c6b31b9e93774abb2822c2f346c287` | `src/serverparam.cpp`, `src/player.cpp`: configurable ball parameters and explicit actions. Retain real units and surface/difficulty parameters rather than transplanting its abstract server simulation. License terms are in the downloaded source headers and COPYING.LESSER; no source copied. |
| [Rapier](https://github.com/dimforge/rapier) | `475caa3ff4646fd9a796b67d14116256f4962bc7` | `src/dynamics/solver/`, `src/geometry/`: contact impulses, friction and restitution. Keep the existing pinned browser package, CCD, round posts, player colliders and net contacts. Apache-2.0. |
| [Cannon-es](https://github.com/pmndrs/cannon-es) | `dd971c4a604acdbb211955382e7a80de1f31edfb` | `src/equations/FrictionEquation.ts`, `src/world/Narrowphase.ts`: bounded tangential friction. Use the contact principle in our own spin model; do not ship another collision solver. MIT. |

These are design references. This change contains original JavaScript and does
not vendor or translate third-party source. Downloading multiple engines does
not mean they should all run together. Rapier already handles the collision
world; the custom model handles the football's uncapped spin.

## Changes a player can notice

- Backspin now checks the ball on landing. Overspin can carry it forward.
  Ground friction transfers momentum between spin and travel instead of merely
  making the spin catch up with the ball. Rolling resistance and the campus
  surfaces remain distinct. Friction cannot add kinetic energy or reverse slip.
- A shot outside the aim-assist cone follows its input bearing, including a
  sideways or backward bearing. Previously the launch was still aimed at the
  attacking goal plane even after `aimShot` said assistance was disabled.
- CPU shots and crosses now use the same drag/spin-aware launch solver as human
  kicks. Crosses are aimed to arrive at head height, rather than receiving an
  approximate upward velocity unrelated to their flight.
- Pass assistance considers opponents in the lane and near the receiver when
  choosing between similarly aimed teammates. Explicit aim still matters and a
  blocked pass remains possible when there is no better receiver in that direction.
  Human and CPU passes to a receiver are weighted using the actual surface,
  sliding friction and drag, so they arrive at a controllable pace instead of
  stopping short after the new grip takes effect.
- Launch searches no longer allocate arrays of trajectory points they discard.
  Visible set-piece previews still receive their sampled points. A reused air
  acceleration vector also removes one allocation per predicted integration step.

No libraries, animation assets or other large assets were added. The fixed
60 Hz simulation, inputs, match rules, menus and development debug API remain.
The debug API adds `cpuKick` and spin state for reproducible physics checks;
it must remain absent from production.

## Reproduce validation

From the repository root:

```sh
npm test
npm run build
```

With `npm run dev -- --port 5173 --strictPort` running in another terminal:

```sh
python tools/smoke_match.py
python tools/smoke_physics.py
```

Then start `npm run preview -- --port 4173 --strictPort` and run:

```sh
FOOTBALL_BASE_URL=http://127.0.0.1:4173 python tools/smoke_physics.py --production
```

Browser scripts require Python Playwright and Chromium, as documented for the
existing match smoke test. Production validation exercises keyboard movement,
pause/resume, version metadata, real touch events in a phone-sized landscape
viewport, and absence of the debug API. This is browser emulation, not a frame
rate, thermal, memory or battery measurement on a physical phone.

The current validation passed 47 Node tests, the full two-half browser match
with saved-win progression, the targeted development physics checks, and the
production desktop/touch smoke check. The production build succeeds with the
existing bundle-size warning. The win fixture now establishes a winning lead
explicitly because the earlier CPU counterattack scenario can itself score.

## Scope

This is a first physics/gameplay upgrade, not parity with PES/eFootball. Player
animation transitions, first-touch control, team tactics, contact behavior,
keeper prediction on curved shots, and performance on actual phones still need
dedicated playtesting and further work. Online services and competitive
multiplayer are separate requirements.
