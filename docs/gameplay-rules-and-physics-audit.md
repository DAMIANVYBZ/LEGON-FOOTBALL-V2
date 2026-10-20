# Gameplay rules and physics audit

This is a source comparison and a browser audit, not a claim that the browser
module is already equivalent to Google Research Football. The reference checkout
is `google-research/football` at
`3d9e754720a95621bba6475c4d3b0d56fe919014`. Its native game was not built or played.
The browser game retains React, Three.js, Rapier and its seven-a-side venues.
No Google source files were copied or translated in this change.

## Reference inspected

- [`referee.cpp`](https://github.com/google-research/football/blob/3d9e754720a95621bba6475c4d3b0d56fe919014/third_party/gfootball_engine/src/onthepitch/referee.cpp): `BallTouched`, offside snapshots and restarts.
- [`ball.cpp`](https://github.com/google-research/football/blob/3d9e754720a95621bba6475c4d3b0d56fe919014/third_party/gfootball_engine/src/onthepitch/ball.cpp): gravity, drag, grass contact, spin, woodwork, net and bounce.
- [`humanoid.cpp`](https://github.com/google-research/football/blob/3d9e754720a95621bba6475c4d3b0d56fe919014/third_party/gfootball_engine/src/onthepitch/player/humanoid/humanoid.cpp): separate movement and timed ball contacts.
- [`elizacontroller.cpp`](https://github.com/google-research/football/blob/3d9e754720a95621bba6475c4d3b0d56fe919014/third_party/gfootball_engine/src/onthepitch/player/controller/elizacontroller.cpp): receiver prediction, passing and movement decisions.

## Problems addressed

| Area | Previous behaviour | Change |
| --- | --- | --- |
| Offside | No position tracking or infringements | Snapshot the second-last opponent, ball and attackers at a teammate touch; enforce on involvement, in either direction. Own-half players, level players and players behind the ball are onside. |
| Rebounds and offside | No phase existed | Preserve the attacking phase through woodwork, accidental opponent deflections and keeper saves. Deliberate opponent control starts a new phase. |
| Offside involvement | None | Touching/playing the ball, nearby challenges and keeper screening use ground-position proxies. Screening is restricted to a shot heading at goal. |
| Restart exemptions | No offside-aware delivery | Direct corner, goal-kick and throw-in delivery are exempt. A subsequent teammate touch starts a new phase. |
| Indirect restarts | No indirect free kick | Offside and restart double touches award indirect free kicks; a direct goal without another player touch awards a goal kick. A direct own goal from a restart awards a corner. |
| Throw-ins | Ball was moved inside and automatically launched | Establish a real restart with a taker, release from throw height and apply offside/direct-goal/double-touch restrictions. |
| Goals | Centre tested against posts/bar; a ball already behind the line could score | Require a whole-ball crossing from the pitch side and clearance inside the goal mouth. Test single scoring, woodwork and net response. |
| Chips | Backward/sideways input could be forced toward the opponent goal | Use the shot assist cone; preserve the selected bearing outside that cone and launch with backspin. |
| Ground bounce | Grass impact speed ratio measured about 0.319 | Use Google's 0.62 grass bounce coefficient and 0.06 m/s impact loss as a baseline; retain distinct campus surfaces. |
| Rolling resistance | Grass baseline 1.2 m/s² | Use 1.6 m/s² as the reference baseline; the launch solver reads the same updated surfaces. This is not a port of all native friction calculations. |
| CPU progression | Unmarked backward outlets could be repeatedly selected while free | Advance or find a forward pass when unpressured; retain backward outlets under pressure. Natural CPU decisions exclude teammates currently beyond the offside line. |
| Support runs | Could wait beyond the defensive line | Off-ball attack support positions wait behind the current line; a chosen receiver can run beyond it after the pass. |
| Knocked-down player | A stationary recovering human could collect/kick the ball; headers did not check recovery | Block pickup, kicks and attacking headers during recovery. |
| Replay consistency | One tackle impulse used unseeded randomness | Use the match's seeded generator. |

The previously completed receiver braking, consistent reception limits,
opponent dribble deflections and bounded first-touch settling remain included.
See [the work log](gameplay-work-log.md).

## Validation approach

`npm test` covers pure rule phases, offside exceptions, interference proxies,
mirrored directions, goal geometry, chip bearings, bounce calibration, support
positions, movement, spin and existing application regressions.

`python tools/audit_rules.py` runs ten groups at each of all eight venues:
actual home/away offside infringements, exempt deliveries, indirect direct-goal
restriction, restart double touches, chip bearings, post/bar rebounds, no goals
from behind the line, and single scoring on a valid crossing. The astroturf
fixtures use its actual 5.5 m by 2.2 m goals.

`python tools/audit_first_half.py` runs the existing 17 gameplay groups per
venue, then a fresh accelerated first half with finite-state/stamina checks,
input decisions, actual rendering, screenshots and halftime validation.
`python tools/audit_match_edges.py` checks 11 boundary/input groups per venue,
including phone multi-touch, cancellation, pause and resumption.

`python tools/smoke_match.py` still requires actual CPU tackling and a shot,
keeper catches/distribution/punches/dives, passing, lofted reception or a header,
halftime/fulltime and exactly one saved win. Its counterattack allowance is
18 simulated seconds instead of 15 after the physics/decision changes; no
assertions were disabled. The old scoring fixture spawned a ball already
behind the goal line. It now makes a real crossing, with the human out of its
path. Throw-in audit assertions now expect the actual throw-in restart.

Build and production desktop/phone checks verify bundling, movement, touch
ownership, passing, pause, version metadata and absence of the debug API.
Current machine logs/artifacts live under `/workspace/playtest-artifacts/`.
The final work-log entry records completed run outcomes; commands described
here alone are not evidence they passed.

## Remaining differences and limitations

| System | Remaining difference |
| --- | --- |
| Player bodies | Ball/player capsules exist, but footballers do not yet have a full body-separation/contact-response controller. Players can overlap. |
| Touches/animation | Settling is bounded positional control. Dribble and trap impulses are not synchronised to foot-contact animation frames as in the native engine. |
| Offside geometry | Uses player ground centres and simple challenge/sight-line proxies, not articulated body parts or a complete referee interpretation of interference. |
| Keepers | Saves use a threat model and probabilistic outcomes, not the native animation/contact system. Complete handling restrictions such as teammate back-passes and rehandling are not implemented. |
| Ball dynamics | Google bounce/rolling baselines are adopted, but drag, Magnus lift, contact friction, spin integration and solver timestep remain the browser model. Exact trajectories have not been matched against native replays. |
| Team AI | Seven-a-side support/marking/pressing and simple carrier decisions differ from Google's full team controllers and learned policies. |
| Halves | The timer, halftime, conceding-side kickoff and result persistence are exercised, but teams do not yet exchange physical ends at halftime. |
| Refereeing | Full advantage, all handling/disciplinary cases and all restart technicalities are not modelled. |
| Competition | No complete penalty shootout, substitutions or full tournament system. |
| Multiplayer | No authoritative online match/booking service; browser progression remains local. |

These are recorded gaps, not claims of equivalence or of a completely finished
football simulation. The next substantial stages are body separation,
animation-timed touches, keeper handling rules and halftime end changes, followed
by native/browser trajectory comparison and tactical playtesting.
