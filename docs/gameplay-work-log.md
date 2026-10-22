# Gameplay work log

## Working agreement

Improve gameplay iteratively, using Google Research Football as a source
reference where useful. Reproduce a concrete problem, make a focused change,
and test the actual browser game. Do not claim parity with Google's gameplay;
its native engine has not been run here. No Google code has been copied.

Show gameplay evidence as inline screenshots when requested. The user cannot
watch the supplied MP4 links. Describe controlled scenarios as controlled
scenarios, not normal uninterrupted play. Changes remain local unless the user
requests publishing/deployment and the necessary access is verified.

## Completed: receiver approach and reception

See [the receiving review](gameplay-receiving-review.md). Receivers brake on
approach; home reception paths enforce consistent reach, height, speed and
control-lock checks; away recipients use the same physical reception limits.
The 52-test suite, build, full-match browser regression and desktop/phone
production checks passed at that iteration.

Actual browser comparison used a forward pass to a receiver initially at
x=12 m, with receiving point x=14.5 m. Restoring only the old approach made the
receiver reach x=15.40 m and receive at approximately 1.2 s. The fixed approach
reached x=14.15 m and received at approximately 1.0 s. These are scenario-specific
measurements, not a general performance guarantee.
Screenshots and replay artifacts are in
`/workspace/playtest-artifacts/receiving-demo/`; `comparison.png` shows the
overshoot side by side. The user asked to retain this context and continue.

## Next completed implementation: dribble body deflections

The dribble loop overwrote Rapier's position and velocity after physical
contact with an opponent. The ball remained attached to its carrier despite
the obstruction. An isolated browser scenario put the home carrier at x=0,
ball at x=0.68, and an opponent at x=0.95, temporarily inactive to isolate
physical contact from the CPU tackle decision. Before the fix, possession
remained with the carrier and the ball's velocity was repeatedly zeroed.

Opponent contact now releases possession, preserves the physics response,
records the opponent's last touch and applies a brief 0.12 s recovery lock to
both teams. It does not automatically award the opponent possession or count
the contact as a tackle. Teammate contacts and keeper-held balls do not trigger
this dribble release rule.

Physics also reports continuing solver contacts, since contact-start events
alone cannot detect a ball still pressed against an opponent after control is
regained. The browser scenario supports `downFor` on player fixtures to isolate
physical obstruction without CPU movement or tackles; this API is dev-only.

Regression coverage: `npm test` includes continuing-contact detection, and
`python tools/smoke_physics.py` checks physical dribble release for both teams
alongside passing and shooting. `python tools/smoke_match.py` checks the full
match flow. Consult current command results before claiming later validation.

## Completed: remove first-touch position snaps

In a controlled browser scenario, a ball at x=-0.9 m travelling at 2 m/s was
collected by a stationary home player at x=0. The old carry constraint moved it
to x=0.5 m in one simulation step: a 1.4 m jump. The same path also forced a
received ball below 0.85 m straight to ground height.

New acquisitions now use a settling phase before normal dribble constraints.
Horizontal positional correction is bounded at 6 m/s and vertical correction
at 3 m/s; the physical movement that precedes correction still applies. The
phase ends near the ordinary dribble point, rather than after a fixed timeout.
It resets after loss of possession, keeper handling, restarts and match reset.
The common carry path applies it to either team. Existing opponent-contact
release still operates during settling.

In the same browser scenario the first step moves from -0.9 m to -0.768 m
(0.132 m including physical travel); at 0.5 s the ball is at x=0.665 m, close
to the normal 0.68 m dribble point. Browser checks cover a ground ball from
behind and a raised reception, asserting no large first-step horizontal or
vertical snap and eventual settled possession. Unit coverage checks limits
and convergence at 30, 60 and 120 Hz in both facing directions.

Validation: 54 tests pass, production build succeeds, physics/passing browser
checks and full-match browser checks pass with no JavaScript errors. The build
retains its existing large-bundle warning. This is bounded positional control,
not an implementation of Google's animation-timed trap or full first-touch
physics; no native code was copied.

Remaining candidates: timed dribble touches, momentum-based first-touch control,
animation/contact synchronisation, player body separation and team tactics.

## Broad rules and physics overhaul

The user expanded the scope to all gameplay, specifically offsides/tracking,
goals, chips and rebounding shots, with Google Research Football as the target
reference. See [the full comparison and gap list](gameplay-rules-and-physics-audit.md).

Implemented offside snapshots and involvement in both directions, restart
exemptions, defensive-save/deflection phase preservation, indirect free kicks,
restart double-touch restrictions, proper throw-in restart state, direct-goal
restrictions, whole-ball goal geometry and prevention of goals from an already
out-of-play ball. Chip aim now respects backward/sideways input. Grass bounce
and rolling baselines use Google's reference values. Supporting AI stays behind
the current offside line, and free carriers no longer recycle passes solely to
unmarked players behind them. Recovering players cannot collect/kick/header the
ball. One tackle impulse now uses the seeded match random source.

Completed validation on the final implementation:

- `npm test`: 67 passed, zero failures or skipped tests.
- `npm run build`: succeeds; existing large-bundle warning remains.
- `python tools/audit_rules.py`: 80 rule/physics groups across eight venues.
- `python tools/audit_first_half.py`: 136 gameplay groups plus a fresh first
  half to halftime at each of eight venues; finite motion/ball/stamina checks.
- `python tools/audit_match_edges.py`: 88 boundary and phone-input groups
  across eight venues.
- `python tools/smoke_physics.py`: passing, first-touch settling, dribble body
  deflections for either team, shot trajectories and crosses pass.
- `python tools/smoke_match.py`: counterattack, both keepers, real keyboard
  passing, crossing/heading, halftime, fulltime and one saved win pass.
- Production `smoke_physics.py --production`: desktop and landscape phone
  movement, multi-touch, pass/pause, version metadata and no debug API pass.
- No JavaScript errors reported by the completed browser checks.

The 304 browser audit groups comprise 80 + 136 + 88; this is not a count of
304 independent matches. Most fixtures use deterministic accelerated steps.
First-half runs use actual rendering and input decisions, not normal-speed
human playtesting or physical-phone performance testing.

Artifacts are under `/workspace/playtest-artifacts/rules-audit/`,
`full-gameplay-audit/` and `edge-audit/`. The gameplay audit contains actual
kickoff, live-play and halftime screenshots. Changes remain local and have not
been committed, pushed or deployed.

Remaining substantial gaps: full player body separation, animation-timed
physical touches, native-matched aerodynamic/solver trajectories, complete
keeper handling rules, physical end changes at halftime, advanced team tactics
and complete referee/competition rules. Do not describe this as complete Google
Research Football parity. Continue with these recorded gaps on future iterations.

## Fouls, restart taking and cameras

User prioritised camera movement/placement and complained of too many simple
fouls. See [the detailed review](fouls-restarts-camera-review.md).

Reproduced 17 random fouls in 40 clean standing-poke fixtures; changed judgments
to ball-route/contact/approach-speed checks. The same fixtures now have zero
fouls, while a separate reckless body-first slide still earns a foul and red.
CPU pokes jockey when the ball is shielded instead of rolling simple fouls.

Fixed clipped and stale restart-camera poses, fitted taker/ball/target views,
removed the delayed hard cut after delivery, eased phone zoom and added high-ball
look height. Goal kicks, throw-ins and indirect/long free kicks also get proper
restart framing. Default phone controls stay clear; the radar hides in this view.
Visual inspection caught a second issue: far-side animated takers disappeared
while their selection marker remained visible. Disabling frustum culling for
player skinned meshes fixed actual Astroturf/stadium screenshots; scenery culling
remains enabled.

Short restart passes no longer use the airborne solver (an old fixture had
12.33 m/s upward speed). They target teammates, roll on the surface and use a
matching run-up/ground preview. Goal kicks now share aim/charge/run-up controls.
Penalties wait for readiness; a passed penalty is tapped forward. Both teams
have a short option offered at restarts.

Validation: 72 unit tests; 72 camera-framing cases across all three camera modes,
both teams and desktop/phone; sixteen foul/restart behaviour groups; four release
transition replays; eight consecutive-corner checks without resetting the match;
phone magnification/touchline/paused-rendering checks; Sarbah's seventeen gameplay
groups and first half; all-venue rules regression; full-match flow and production
desktop/phone control checks. Build passes with the pre-existing large-bundle
warning. All-venue camera captures include image-based corner-taker visibility
checks. Refer to the completed machine reports for run details.

Artifacts: `/workspace/playtest-artifacts/fouls-camera-audit/` and
`/workspace/playtest-artifacts/camera-venues/`. Prefer inline screenshot evidence;
the user cannot watch supplied MP4 links. Software-rendered browser evidence is
not a physical-device frame-rate benchmark. Changes remain local, not deployed.

## Closer possession camera (2026-10-20)

User chose to keep Netlify and requested substantially larger players and a
camera that follows possession instead of covering the stadium. Reviewed
Google Research Football `match.cpp` camera section (around lines 510–590):
60% possession-player bias, anticipation and smoothed tracking. Implemented
our own framing helper with this bias, bounded velocity lead and full lateral
tracking. Default camera offsets reduced from 47%/60% of pitch width to
30%/39%, with no fixed near-side focus. Wide is also closer but retains more
context; behind-player follows either team's possession. Restart framing and
exponential smoothing remain in place.

At Sarbah midfield, geometric projection predicts players about 71% taller
than the old default view (desktop 35→60 px at 1280×720; phone 24→41 px at
844×390). This is a controlled projection comparison, not a Google runtime
comparison or a frame-rate benchmark. New browser checker saves actual
screenshots and projected positions in `/workspace/playtest-artifacts/close-camera`.
All 73 unit tests, the existing phone/tablet/desktop camera browser check and
production build pass. Netlify builds from GitHub main; direct Netlify access
remains blocked by the session network proxy, so publishing must not be claimed
as verified without a live result.

## Defending, slide recovery and player appearance (2026-10-20)

User reports repeated bot slides, momentarily disappearing players, unrealistically
fast get-up, failed repeated tackles, and toy-like player appearance. Root causes
and changes are recorded in [the defending/player review](defending-and-player-animation-review.md).
CPU ordinary tackles now use an upright poke only in reach; primary defenders
work around shields and supporting defenders contain. Get-up animation speed is
halved, missed recovery doubles, and a successful slide must also get up. Same-
action replay no longer fades to the bind pose. Restore the original model's
texture/normal maps instead of discarding facial and clothing detail. Existing
mesh geometry is retained. User wants Netlify retained for now; publishing remains
authorized through main, but a Netlify live result cannot be verified directly
from this environment.

## More lively commentary and male voice preference

User requests a male commentator and more interesting delivery. Fixed the voice
selector: `/male/` also matched "female", and "Google UK" selected either gender.
Now prefer identified male English voices, ranking natural/neural/enhanced voices
and regional English varieties. The browser speech API has no standard gender
field: names identify known voices; when no male voice is installed, use the
available device fallback. Do not promise the same voice across phones/computers
or describe synthetic/stub tests as listening to real commentary.

Delivery has a lower base pitch and quicker excited calls without a high-pitched
jump. Goals distinguish openers, equalisers, taking/extending a lead and pulling
one back while still trailing. Shots and saves interrupt routine chatter. Shorter
shot/save cooldowns avoid suppressing separate chances for ten seconds. Queued
reactions expire, and cancelled utterance callbacks cannot resume stale lines.
Dispose speech listeners and guards when leaving a match. Reword repetitive lines
and remove unsupported claims that a generic foul was from behind, woodwork was
specifically the bar, or a generic miss was over the bar.

Validation: 81 unit tests and production build pass. Five physical goal crossings
in Chromium produced correct context/score captions and preferred an advertised
male voice over the female default with no JavaScript errors. Browser speech was
stubbed to inspect selection and timing; this does not assess audible naturalness
or the voices installed on the user's device. Replay: tools/check_commentary.py.

## Controller menus, pass charge, slides and spin — 2026-10-21

User requested eight corrections: gamepad halftime/fulltime menus, soft fouls,
unseen goal kicks, slide direction/positioning, charged pass speed/range, a slower
connected spin, R1/R2 sprint speeds, and falls occurring before slide contact.
Implemented and checked these behaviors; see
[controller/gameplay corrections](controller-gameplay-fixes.md) for timings,
measurements, fixtures and limitations. 86 unit tests and the build pass, the
focused controller replay passes, and all 41 legacy fixture groups plus a full
match pass. Production controls are checked on desktop and emulated landscape
phone. The user also asked to open the in-chat browser; this session has no such
interactive panel, so show browser screenshots and explain that limitation.

## GitHub Pages migration — 2026-10-21

User ran out of Netlify credits and explicitly requested hosting on GitHub.
Prepare GitHub Actions deployment for `main` to the `github-pages` environment,
with build/test, Pages artifact and deploy jobs. Base-path support covers logo,
FBX/GLB loaders, animation library, manifest and version polling. Default root
hosting remains supported. Project URL:
https://damianvybz.github.io/LEGON-FOOTBALL-V2/ . No domain/DNS changes requested.

Strict subpath hosting exposed pre-existing unavailable FBX texture URLs pointing
to `/home/app/mixamo-mini/tmp/skins_….fbm/`. Those files are not in the checkout or
supplied files. Do not describe these maps as successfully restored: a Texture
object existed, but its source failed to load. Ignore only these known obsolete
export references, remove their unsupported maps, and retain material colour
fallbacks. Valid supplied or embedded textures remain supported.

88 unit tests and the project-path build pass. Production desktop/phone control
checks run under `/LEGON-FOOTBALL-V2/`; a strict static-server Oval model/GLB/asset
check verifies missing paths without SPA fallbacks. See README for setup/replay.

GitHub Pages GET and POST API calls return Forbidden from this session. The Pages
site cannot be enabled or its settings inspected through that API here. The owner
may need to select Settings → Pages → Source: GitHub Actions and run the deployment
workflow. Do not claim the public site is live without verification.


## Cloudflare Workers deployment correction — 2026-10-21

User chose Cloudflare with the Namecheap domain instead of publishing the GitHub
Pages draft. No GitHub Pages workflow was committed or published. The screenshot
shows Cloudflare Workers Git builds: `npm run build` succeeds, then
`npx wrangler deploy` fails while parsing vite.config.js. Supply `wrangler.jsonc`
with Worker name `legon-football-v2`, compatibility date and static asset directory
`dist`; pin Wrangler 4.151.3 and expose deploy/dry-run scripts. Keep root base `/`
for Workers and custom domains. Do not tell the user to recreate the project as
Pages: the existing Workers static-assets deployment can host this game.

The base-path and missing-export-texture repairs from hosting preparation are
retained and tested. The planned GitHub Actions workflow was removed before any
push. Direct Cloudflare account/DNS control is unavailable in this session; push
the configuration and have the connected Cloudflare build deploy the new commit.
A local Wrangler dry run verifies packaging, not a live publication or domain.

Cloudflare correction verification: 88 tests pass; root production build passes;
Wrangler 4.151.3 dry run reads all 51 static files and exits successfully without
parsing vite.config.js as a Worker config. Strict root and project-path browser
checks load player FBX, animation library, manifest, logo and Oval GLB with no
missing local assets or JavaScript errors. Production project-path desktop and
phone controls also pass. The connected Cloudflare account must report the new
commit as Published before a live deployment can be claimed.

## 2026-10-21 — close ground control and released kick inputs

User supplied current hosting URL:
https://legon-football-v2.damiannyckid00.workers.dev/ . Outbound proxy rejects
access to this host with HTTP 403, so local checks cannot certify its deployment.

Ground-control fixes: align fallback rendered turf with the physics floor (it
was 7 cm below it), lower imported baked pitches by their 3 cm export offset,
and retain pitch markings just above the same floor. Use speed-dependent boot
spacing: 38 cm at rest, up to 50 cm jogging and 62 cm sprinting. Turning and
trapping share a bounded correction instead of snapping the ball across the
player. Set rolling spin from carrier velocity to avoid the frozen-sphere look.

A released pass, through ball, chip or shot now retries for at most 300 ms while
waiting for reachable ground contact/control lock, retaining the charged power.
The buffer is bound to the controlled player, expires, and clears on pause,
reset, restart, opponent possession or knockdown. Ground kicks require horizontal
reach and foot height, avoiding kicks of airborne balls from far below them.
Dev-only scenario controlLockFor reproduces receipt/contact timing without
changing production controls. Browser fixtures are in tools/audit_ball_control.py.

Verification: 89 unit tests pass, production build succeeds, and Wrangler dry
run packages 51 files. Chromium controlled fixtures confirm stationary spacing
0.398 m at ball centre height 0.11 m, grounded running control, one released
pass/shot/chip surviving a 280 ms lock, and expiration without a delayed kick.
The controller regression replay also passes charged passes, sprint, slides,
connected spin, visible boundary restart and half/full-time menus, with no
JavaScript errors. Screenshot: playtest-artifacts/ball-control/close-ground-control.png
(outside the repository; isolated fixture with other players moved away).
Additional physics browser replay passes 5/12/24 m receptions, home/away opponent
body deflections, behind/raised first touches, manual aim, CPU shot height and
lofted crossing with no JS errors. Body-contact fixture starts at the new 38 cm
resting dribble point and moves the blocker by the same amount to preserve the
original 27 cm ball-to-defender separation.

## 2026-10-21 — repair pass release regression

User reported passing stopped working after 1f40c83. Reproduced a stationary
backward pass at the new 38 cm dribble point: initial vx=-12.5 m/s became
+3.58 m/s on the first physics step, leaving the ball on the wrong side of the
passer. The coarse whole-body capsule blocked the strike through the player's
stance. Previous isolated pass checks exercised forward release, missing this.

Physics releaseFrom(index) briefly makes only the striker's capsule a sensor,
until the ball clears 50 cm horizontally or 180 ms expires. Opponents remain
solid throughout. Apply on successful human, CPU and set-piece kicks; reset
clears it. Do not move/teleport the ball or loosen opponent collisions. The
new physics regression checks backward travel and an opponent interception.
Browser directional pass audit verifies actual ball progress, quick/charged
passes and real keyboard/gamepad/touch release paths, not pass counters alone.

Body-deflection smoke fixture now inspects the first deflection event rather
than asserting last touch after another 100 ms, when the rebound can legitimately
hit the former carrier's solid body again.

Release validation: 90 unit tests pass, including minimum-speed tap passes and
charged backward passes, with a solid opponent intercepting normally. Production
build and Wrangler packaging dry run pass. Physics browser replay passes 5/12/24 m
receptions, first-touch bounds, home/away dribble deflections, shots and crosses.
The browser release audit covers eight directions at three charge lengths and
actual keyboard, gamepad and touchscreen events. The touch directional fixture
holds its receiver stationary; moving receivers can legitimately change the
assisted launch direction while the browser is waiting to dispatch a tap.

## 2026-10-21 — recording exposes running-pass recapture

User supplied Screen Recording 2026-10-21 192142.mp4 (33.53 seconds). Inspected
one-second frames across gameplay and quarter-second frames at 16–19 s. PASS!
and the strike animation appear while the ball stays beside the moving player.
The stationary backwards-release repair did not address this running case.

Reproduced on Oval with continuous forward movement and no defenders: a tap
launched at 8 m/s regardless of the passer's movement. While sprinting at about
7.2 m/s the ball never got more than 0.60 m ahead and the player regained
possession within one second. Ordinary jogging taps also recaptured, with max
gap 0.77 m. The player accelerates to off-ball running speed after releasing,
while ground friction slows the low-powered pass. This is why animation-only
or stationary release checks missed the visible failure.

Ground passes now add the passer's velocity component towards the actual launch
direction to the charged strike speed. A sprinting tap therefore launches at
about 15 m/s instead of 8 m/s; backward/lateral passes retain their base speed,
and holding pass still increases strike speed/range. Keep the ball's actual
position, physical friction, normal interceptions and normal possession pickup.
Do not mask the issue with a longer possession lock or a ball teleport.

Regression tool tools/audit_moving_pass.py holds movement throughout charging
and after release: real controller polling in normal/R2/R1 modes, short taps
and charged passes, ordinary active teams in an open lane, real keyboard input,
and a three-finger touchscreen move+sprint+pass gesture. Check separation from
the moving player and absence of premature recapture, not animation/counters.

Verification: all 91 unit tests pass; production build and Wrangler dry run
pass. The prior 24 directional/stationary pass replay still passes keyboard,
controller and touchscreen release. New moving-pass replay passes nine
controller mode/charge combinations with movement held for a full second after
release; normal active sides in an open lane; real keyboard sprint+pass; and
three simultaneous touch contacts, lifting only PASS while move+sprint remain
held. No JavaScript errors. Results are at
/workspace/playtest-artifacts/moving-pass/results.json. CDP touchEnd specifies
the contacts being ended, so end only the pass contact in this test, not the
stick/sprint contacts.

## 2026-10-21 — goal-kick formation no longer abandons the centre

User screenshot showed both teams arranged in two touchline columns at a home
goal kick. Ordinary supportPosition reused each formation row's wide spawn
lanes, with no goal-kick-specific build-up shape. Added goalKickPosition for six
outfield roles: two short split outlets, central pivot, staggered midfield,
one higher wide option and central forward. Opposing forwards press outside
the box, midfield covers central lanes, defenders retain deeper positions.
Mirror coordinates for the opposite kicking team and scale for pitch size.

While a goal kick is pending this plan takes priority over ordinary formation
support and the single short-receiver override. Players move into the shape
through normal movement; no teleport, kick timing or camera changes. Existing
opponent penalty-area exclusion still applies; the kicking team's players may
receive inside their own penalty area.

Verification: 92 unit tests pass; production build and Wrangler static-assets
packaging pass. Browser tools/audit_goal_kick_shape.py checks both ball sides,
central outlets and short options, compact legal opponents, human short goal
kicks and CPU release, with no JS errors. Sarbah six-second home shape contains
two central red options (z=1.1 m and 0.9 m), two short outlets and staggered
higher support; all blue outfield players stay within 7.3 m of centre width.
Screenshot: /workspace/playtest-artifacts/goal-kick-shape/shape-3.png .


## 2026-10-21 — boot-driven rolling and grounded control

Extend the current close-control fixes with velocity changes gated by animated
boot contacts. Remove the carry position/velocity overwrite, allow independent
rolling between touches, and use a small leg reach for stopping and turns. Keep
the pass momentum, striker release exclusion and central goal-kick shape from
1f40c83 through abfdd86. Released strikes start at the contact portion of their
clip; full-power ground shots use a standing kick. Pending kicks also cancel on
opponent touches, pointer cancellation, pause and restarts.

Reposition physics player bodies at kickoffs/restarts along with the ball so a
placement cannot impart an artificial kinematic collision velocity. Imported
grass alignment is measured against the physical floor. Existing fallback turf
alignment and phone zoom remain in place. See [boot-control physics](boot-control-physics.md)
for implementation, measured gaps, replay commands and validation limits.

Verified: 99 unit tests; 136 event groups and first-half completion in all eight
venues; 80 rules groups across the same venues; stationary, directional and
moving pass regressions; human/CPU goal-kick positioning; controller charging,
slides, spin and halftime navigation; and 5/12/24 m receptions. The production
build passes desktop keyboard and emulated landscape-phone joystick, multitouch,
pass and pause checks, with no debug API or JavaScript errors. Final first-half
results: /workspace/ball-control-audit/final-venues/audit.json. Earlier transport
and replay-time-budget failures were rerun successfully on the merged code.


## 2026-10-21 — prevent sprinting ahead of the controlled ball

Reproduced the user's sprint regression at varied gait/turn phases: the prior
revision failed 29/84 cases. Add reachable catch-up touches, stride-speed
coordination and bounded lateral recovery while carrying; keep slow recovery
steps animated and preserve R1/R2 speed differences and independent pass travel.
The new sprint audit passes 348 controller cases across worn, artificial and
grass surfaces, including tired players and repeated bursts. All 103 unit tests
and the existing controller, running-pass, boot-control and physics replays pass.
See [sprint recovery details](boot-control-physics.md#sprint-recovery-follow-up--2026-10-21)
for measurements, the baseline failure and replay commands.

The active-team Sarbah first-half replay also completes with all 17 event groups
passing. Production desktop keyboard and emulated landscape-phone joystick,
multitouch, passing and pause checks pass with no JavaScript errors. Build and
Cloudflare static-asset packaging dry run pass.


## 2026-10-22 — grounded, directed sliding tackles

Use the uploaded eFootball clip as a movement reference. Preserve running
momentum, lead the moving ball within a small aiming cone, and keep sliding
after contact. Replace the broad invisible tackle area with swept animated boot
contact and calculate the ball's deflection from the contact angle and motion.
Correct the leg pose, grounded hold and transition through the existing slower
get-up. Judge the opponent's leg/body contact separately from touching the ball,
including body-first fouls/cards and later trips. Exclude the sliding player's
upright collision capsule during the slide; keep loose balls available to play.

The bot replay also exposed a stalled approach beside close shielding. Move its
approach destination past the shield so the defender can reach the exposed ball
with its standing tackle. See [sliding tackle details](sliding-tackles.md) for the
mechanics, measured contact/follow-through distances, replay commands and tests.

Verified: 114 unit tests, 81 slide cases on three surfaces, 51 event groups and
first-half completion on Sarbah/Astro/Oval, controller input/animation/halftime,
and production desktop keyboard and emulated-phone multitouch/pause checks.
Production build and Cloudflare static-asset packaging pass. Detailed artifacts
are in `/workspace/slide-fix-audit/`.

## 2026-10-22 — assisted receiving and throw-in aiming

Blend 60% manual movement with 40% AI guidance while receiving. Predict a
reachable interception point using flight, landing and rolling physics; hand
control over before contact when assisted movement can reach it. Preserve strong
movement away, player lock, ordinary ball control and first-touch restrictions.
Handle short approaching passes without a late control switch. Keep corner
attackers in the box unless a short corner is selected.

Give throw-ins a movable reticle, curved overhead trajectory guide and held
PASS power. Use the same launch calculation for guide, human release and CPU
throws. Keep the taker stationary and the aim inside the pitch, within 22 metres.

## 2026-10-22 — team celebrations and three-angle goal highlights

After either team scores, have the five available outfield teammates run toward
separate positions around the scorer and join the celebration. Allow six
seconds, then play the recorded goal from broadcast, behind-goal and attacking
cameras. Keep a bounded 30 Hz history of actual movement, ball flight and
animation phases; interpolate it without rerunning match physics. Preserve the
score and match clock, and avoid charging stamina for celebrations.

Add separate SKIP CELEBRATION and SKIP REPLAY controls. Support touch/click,
Enter/Space and gamepad actions for either scoring team. A held controller button
advances only one stage. Pause preserves playback position; return to kickoff
for the conceding side with gameplay actions cleared. Restore player visibility
and animation playback when leaving the replay.

Implementation and replay commands: [receiving and goal presentation](receiving-and-goal-replays.md).

Verified: 122 automated tests; 32 assisted reception cases, eight throw-in
trajectory comparisons and 34 gameplay event checks across desktop and phone;
home/away team celebrations, all three moving replay angles, unchanged
score/time/stamina, independent touch/keyboard/gamepad skip and pause/resume;
51 event groups and first-half completion on Sarbah/Astro/Oval; production
desktop keyboard and phone joystick/multitouch/pause checks. The throw-in guide
matched the measured early flight within 0.026 m. Production build and Cloudflare
packaging of 51 assets pass. Detailed results are in
`/workspace/receiving-audit/verification.json`.
Moving-pass regression also passes with full sides active, normal/R2/R1
controller movement, keyboard sprint-pass and three-finger phone
move+sprint+pass, with no browser errors.

## 2026-10-22 — increase receiving assistance to 70%

Increase the receiving movement blend from 40% AI / 60% manual to 70% AI / 30%
manual. The same setting controls interception handoff readiness and receiving
movement for passes, crosses, corners, free kicks, goal kicks and throw-ins.
Update the receiving regression checks and current mechanics documentation.

Verified: all 122 automated tests and 74 receiving/throw-in/gameplay browser
checks pass across desktop and phone at the 70% setting; production build
passes. Results are in `/workspace/receiving-70-audit/`.

## 2026-10-22 — Assisted, Semi and Manual passing/crossing settings

Add Settings → Gameplay with three saved modes. Assisted selects/leads a
recipient and weights the delivery for distance; Semi limits selection to the
aimed lane and uses partial correction, preserving strong charge influence;
Manual launches along the input direction with held-button power and no target
snapping or automatic side curl. Apply the selected behavior to ordinary and
through passes, lobs/crosses, set-piece passing and keeper distributions. Default
existing preferences to Assisted and preserve other saved controls/display
settings. Keep receiving assistance at its separately requested 70% setting.

Give through passes a held power/release action on keyboard and controller;
clear that charge on blur, cancel, restart and reset. Use the selected delivery
plan for Semi/Manual set-piece previews and release, without adding random aim
or power compensation. Handle keeper possession safely when Manual has no
selected teammate. See [passing mode details](passing-assistance-modes.md).

Verified: all 127 automated tests; 78 mode-specific browser checks plus 34
existing gameplay checks across desktop and phone; saved mode restoration after
reload/new match; native Manual keyboard/controller through passes and charged
two-finger phone passing; 74 receiving/throw-in regressions; controller charging,
sprint/slide/spin/halftime and moving-pass checks; 51 event groups and first-half
completion on Sarbah/Astro/Oval; production desktop and phone smoke checks.
Build and Cloudflare packaging of 51 assets pass. Detailed reports and Settings
screenshots are in `/workspace/passing-modes-audit/`.

## 2026-10-22 — Natural UG Stadium grass and shorter slide recovery

Replace the University of Ghana Stadium model’s flat green infield material
with deterministic grass colour texture: small clumps, olive/dry blade flecks,
soft mowing bands and a repeating fibre bump map. Extract only horizontal green
infield triangles, retaining the curved edge beside the blue track, stands,
pitch markings, shadows and the existing ground height. Use the same material
for the procedural stadium fallback. Leave the other venues’ surfaces alone;
release the generated textures/material and extracted geometry on match exit.

Set slide/follow-through to 1.1 seconds and get-up to 0.6 seconds: a full clean
or missed sliding tackle returns control after 1.7 seconds, without the former
2.6-second prone wait after a miss. Preserve boot contact, sliding momentum and
foul/card decisions. Update the browser recovery checks to verify immobility
before the deadline and resumed movement immediately afterwards.

Verified: all 127 automated tests; 81 slide scenarios across UG Stadium, Astro
and Sarbah; upright bot tackling/foul rules and 12 rendered skeleton samples
through slide/get-up/resumed movement. Desktop and emulated landscape-phone
checks cover Co-op, Wide and Behind player views, ordinary running/passing and
grounded ball height. The procedural stadium fallback also renders correctly
when its imported model is unavailable. No browser/shader errors were observed.
Production build and Cloudflare dry-run packaging of 51 assets pass. Reports,
rendered views and logs are in `/workspace/stadium-grass-audit/`.

## 2026-10-22 — mobile commentary speech activation

User reports commentary silent on phones. Startup spoke kickoff asynchronously
after asset loading; the only unlock was a one-shot pointerdown that queued a
silent blank and permanently considered permission unlocked. It could miss the
Kick Off gesture entirely and could not retry a rejected utterance.

Prime a real audible welcome synchronously from navigation to a game in the
Kick Off/Quick Match/booking button's click, respecting commentary OFF. Use
persistent touchend/click/keydown listeners inside the match, not pointerdown,
and remove them on disposal. Retry a recent blocked or never-started actual
line from a subsequent gesture, deduplicate a touch's synthetic click, retain
utterances through playback, resume paused speech, and expire old reactions.
Phone voice selection prefers an installed local male English voice when one
is available; no remote speech service, credentials or audio downloads added.
Caption-only behavior remains when Web Speech is absent.

Verification: 138 unit tests pass, including real-word priming, rejected speech,
repeat failed gestures, lazy voices, local male preference, suspended speech,
muting and throwing speech engines. tools/audit_mobile_commentary.py passes
landscape touch-browser startup, blocked in-match goal recovery on a later tap,
and commentary OFF, with no JS errors. Its speech service deliberately stubs
mobile gesture restrictions; this is NOT an audible physical-iPhone/Android
check. Results: /workspace/playtest-artifacts/mobile-commentary/results.json .
Production build and Cloudflare static asset dry run also pass.

## 2026-10-22 — clear-glass, context-sensitive four-button phone controls

User explicitly wants clear glass rather than faded controls, and four action
buttons rather than extra tackle/jockey buttons. Use possession to map ○ from
Shoot to Slide, × from Pass to Standing Tackle, and the context button from
Jockey (the requested attacking shield/protect action) to Switch Player. Sprint
remains the fourth button. Preserve the keeper's Put Down action on the same
context button while holding the ball in hands.

Added shared touchActions mapping and live engine-side resolution at press.
Labels follow team possession/restarts/keeper control. Stable button identities
and captured press actions prevent a held shot/pass changing into another
release action after possession changes. Cancel invalid holds while retaining
joystick/sprint pointer ownership. Standing tackle and player switch call their
explicit mechanics; off-ball attack taps cannot fall through to keyboard tackle
fallbacks. Keyboard and physical gamepad mappings remain unchanged.

Remove the opacity preference/slider and legacy saved fade; foreground opacity
stays 1. Glass uses nearly clear fills, a light reflective edge and only 1 px
backdrop blur. Remove coloured tints, heavy frost and native blue rectangular
tap highlight. Keep four buttons in the same compact positions with size and
left/right placement preferences retained.

Verification: all 140 unit tests pass, production build passes, Wrangler dry
run packages 51 static assets. tools/audit_touch_controls.py replays actual
mobile touch input for shield hold/release, mode changes, standing ball win,
slide, player switch, held multi-finger movement/sprint through possession
changes, charged pass/shot and off-ball attack guards. Four-button count and
full opacity are checked even with a saved .08 legacy opacity. No JS errors.
Layout screenshots and results: /workspace/playtest-artifacts/touch-controls/ .
Fixtures use the current ten-a-side Sarbah roster, not hardcoded seven-a-side
player indices.
