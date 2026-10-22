# Monkey Post — campus football module

This playable football subgame uses React, Three.js and Vite. It is designed to launch from the LEGONRUSH university lifestyle and bike-racing game when its avatar walks or rides to a campus football location. The original Monkey Post source is unavailable. The supplied LEGONRUSH source was inspected and used for the stadium and Oval scene exports, hall colors and verified field coordinates; the parent source itself stays in its separate repository.

## Run

```sh
npm install
npm run dev
```

`npm run build` produces the static `dist/` folder.

## Gameplay rules and reference audit

Offside is tracked at a teammate's touch and penalised when an offside player
plays the ball, challenges an opponent or screens the keeper in the modelled
shot path. Direct corners, goal kicks and throw-ins are exempt. Woodwork,
deflections and defensive saves preserve the attacking phase. Offside awards
an indirect free kick; it cannot score directly without another player touch.
Throw-ins now wait for a taker, and restart double touches are penalised.

Goals require a full valid crossing between the posts and below the bar. Chips
respect manual aim. The grass bounce and rolling baselines reference Google
Research Football, while the browser engine, seven-a-side tactics and animation
system remain distinct. See the [gameplay audit and remaining differences](docs/gameplay-rules-and-physics-audit.md)
and [ongoing work log](docs/gameplay-work-log.md). Run `python tools/audit_rules.py`
against the development server for the all-venue rules regression.

## Campus arrival integration

The parent game detects arrival/proximity at a field, then opens this football window with one of these venue IDs: `sarbah`, `gonja`, `nania-main`, `nania-north`, `nania-east`, `astro`, `oval`, `ug-stadium`. The football window shows a Yes/Not Now prompt. Yes opens match setup at that field, where the player chooses hall teams, difficulty, match length and formation, then kicks off. The device (touch or keyboard) is detected automatically and can be changed before kickoff. The venue is fixed by the arrival point. **Quick Match** on the landing page and main menu replays the last settings used on this device.

The simplest launch is a URL such as `/?venue=sarbah`. If the parent embeds the football game in an iframe, it can send:

```js
footballFrame.contentWindow.postMessage(
  { type: 'monkeypost:arrive', venueId: 'sarbah' },
  footballGameOrigin
);
```

For a same-window integration, call `window.MonkeyPostCampus.arriveAtVenue('sarbah')`. The **Campus Fields** page simulates these arrivals when testing the football game on its own. The parent game must call one of these entry points when its own avatar reaches a field; proximity detection cannot run here without the parent game code.

## Venues and match

- Mensah Sarbah Field: worn grass and exposed red earth with paths, trees and covered park seating.
- Gonja Park: a smaller red-soil clearing with trees and simple seating.
- Nania FC: three distinct pitches (main, north and east) with grass or mixed surfaces, neighboring grounds and stands.
- Presec Astroturf: bright artificial turf, perimeter fencing and seating.
- Athletic Oval Mini Stadium: worn grass, running track, basketball and tennis courts.
- University of Ghana Stadium: full-size grass pitch, blue athletics track, tiered seating and floodlights.

The University of Ghana Sports Stadium and Athletic Oval use GLB exports of the supplied LEGONRUSH procedural models (`src/game/stadium.ts` and `src/game/athletics.ts`). Their pitch, track, stands, courts and nearby structures come from those models. The other six venues use stylized 3D interpretations of the supplied aerial references until equivalent source geometry is available. Venue-specific pitch dimensions, surfaces, scenery and camera scaling are applied during play. Pitches are sized for seven-a-side at 75% of each field's full marked size (56 × 36 m at Presec up to 79 × 51 m at the UG Stadium). The stadium and Oval models have a full-size pitch baked in; their white lines and goals are removed at load time (`bakedPitch` in the manifest) and the game draws the seven-a-side pitch on their grass. Matches have seven players per side (six outfield and one goalkeeper), full-size goal frames, basic CPU play and goalkeeper saves, two halves, scoring, throw-ins and pause. Co-op, wide and behind-player cameras are available. Passing aims toward a teammate in the chosen direction and switches control to the receiver when they collect the ball; the other outfielders keep moving.

Presec Astroturf requires a five-minute session booking before kickoff. The five-minute duration, fee and booking horizon are defined in `src/booking.js`, so they can be adjusted later. Each slot has two team places. A vacant opponent place is filled by CPU players. The standalone site's booking and 50-coin sample wallet use browser storage **only as a preview**; they are not cross-device reservations or real campus-game coin payments. A shared service must perform an atomic reservation, check the two team places, and debit the authenticated player's wallet in one transaction. All other campus fields can start a CPU match immediately.

The sides are University of Ghana residences in three groups (`src/teams.js`): traditional halls (Commonwealth, Mensah Sarbah, Legon, Akuafo, Volta), UGEL halls and hostels (Hilla Limann, Alexander Adum Kwapong, Elizabeth Frances Sey, Diamond Jubilee, Jean Nelson Aka, Jubilee Hall, ISH 1 and 2, Valco Hall and the Legon, Sarbah and Akuafo annexes) and private hostels (TF, Bani, Evandy, Pent and the semi-private Sarbah Vikings). Each has a kit colour and a short scoreboard name; when two kits are too alike, the away side wears a white change kit.

## Reusing the main campus game's 3D surroundings

The football module checks `public/campus/manifest.json` for a venue-specific GLB. The supplied LEGONRUSH stadium and Oval are procedural Three.js scenes, not preexisting GLBs. They have now been exported into `public/campus/ug-stadium.glb` and `public/campus/athletic-oval.glb` and loaded directly. The GLBs include their original pitch markings and goals, so the football renderer hides its own copies at those venues.

Additional environment models can be exported as GLBs and added to the manifest, for example:

```json
{
  "sarbah": { "url": "/campus/sarbah-surroundings.glb", "position": [0, 0, 0], "rotationY": 0, "scale": 1, "includesPitch": false }
}
```

The football pitch center is `(0, 0, 0)`, the pitch runs along X, and one unit is one metre. The loaded model replaces the procedural venue scene. Set `includesPitch` when an export already contains the playing surface, lines and goals. The source game's mapped field anchors for Sarbah, Gonja, Oval and Sports Stadium are recorded in `integration/legonrush-proximity.js`; it accepts LEGONRUSH's `game.footXZ` or `game.bikeXZ` position. Presec and the three Nania pitches need confirmed field-center coordinates before their proximity triggers can be wired safely.

## Team Pro integration boundary

Real friends moving off the ball, solo matchmaking, shared bookings and coin balances require authenticated player identities and an authoritative multiplayer service from the campus game. Each side has seven positions: six outfielders and one goalkeeper. The server should assign one human to each claimed position and fill the rest with bots. Human players continue moving their assigned outfielders off the ball; the player receiving a pass owns the ball action while teammates retain their own movement control. A solo entrant should be paired with a solo opponent in the same venue and time slot when one is available. The football client currently implements solo pass-to-receiver control transfer and CPU fillers, but the online transport and shared booking service are **not yet connected**. The standalone static Site cannot provide those server functions by itself.

The supplied rigged character and 29 animation clips are in `public/`. Jogging, dribbling, passing, shooting, tackling, goalkeeper actions, heading and celebration have contextual triggers.

## Controls

Before kickoff, choose Phone, Tablet/iPad or Computer. Phone uses landscape touch controls; Tablet/iPad offers touch or keyboard; Computer uses keyboard only and shows no action buttons. Touch uses a left drag joystick and a compact translucent right-side cluster: △ chip, □ long pass, ○ hold-to-shoot, × pass, Shield, Sprint, Skill and Switch. Keyboard uses WASD to move and aim, Shift to sprint, Q to switch, J to pass/tackle, I for long pass, hold K to shoot, L to chip, H to shield/defend, P for a penalty-style kick, U for an alternate tackle, O for a skill move and Escape to pause.

Controllers (PlayStation, Xbox and generic pads) use the EA FC classic layout. The on-screen hint changes with possession and shows PlayStation symbols or Xbox letters to match the pad.

| Attacking | | Defending | |
|---|---|---|---|
| Left stick | Move | Left stick | Move |
| R1 | Sprint | L1 / right-stick flick | Change player |
| R2 | Controlled sprint | L2 | Jockey (L2 + R2 sprint jockey) |
| L2 | Shield | ▢ | Standing tackle (a foot poked in, or a shoulder barge when running alongside); a miss is a short stumble |
| ✕ | Ground pass: hold for range and speed, release to kick | R1 + ▢ | Hard tackle (longer reach, more fouls) |
| △ | Through pass | ◯ | Slide tackle: aim with the left stick; contact follows the windup, not the button press. Body-first forceful contact can be a foul/card; a clean ball-first tackle remains legal |
| ▢ | Shoot: hold for power; past a tenth of the bar it is a raised shot. Tap ▢ twice for a low driven shot | ✕ hold | Contain |
| ◯ | Lob / cross, always in the air; hold for more power. A cross goes to the near post, penalty spot or far post, whichever the stick points at | R1 hold | Full sprint and teammate contain |
| R2 + ▢ | Finesse shot | △ hold | Goalkeeper rush out |
| L1 + ▢ | Chip shot | R3 | Take control of the goalkeeper (again to hand back) |
| L1 + R1 + ▢ | Power shot | | |
| L1 + left stick | Strafe dribble | | |
| Right stick | Smooth 1.25-second spin with a close ball touch; release to neutral before another move | | |
| L3 + R3 | Player lock (stops automatic switching) | | |

In pause, halftime and full-time windows, use the left stick or D-pad to focus a button and ✕/A to activate it. ◯/B resumes an ordinary pause; at a period break it focuses Leave Match. R1 gives full sprint and R2 gives controlled sprint. Ground passes charge while held; a brief tap favours a short receiver, a longer hold reaches farther and travels faster. Physical exits remain visible for 0.85 seconds before the restart is set up, and the camera follows high balls.

Shots are assisted: while you shoot roughly toward goal, the stick picks a spot inside the goal mouth (src/shooting.js). Turn the stick well away and the shot goes where it points. Error grows with power past three quarters of the bar and with distance, and the keeper needs a moment to read each strike, so shots into the corners score more often than shots at him, and nothing is certain either way. A cross met at head height in the box is headed at goal.

Set pieces. Restart cameras frame the taker, ball and target together, including the goal mouth for close attacking restarts. Each new restart gets its own view; the camera eases back into play after delivery. On phones the radar is hidden during restarts so it cannot cover the ball. At corners, free kicks and goal kicks, a dotted line updates as you aim and charge:

- Left stick moves the reticle (on the goal for a free kick in range, on the pitch for a cross).
- Hold ▢ (shot), ◯ (cross or lofted) or ✕ (short pass) to set the power. Two to three and a half bars of five suits most free kicks; more sends it over.
- During the run-up, the right stick adds spin: down then up dips the ball, a half circle curls it, down-up-down is a knuckleball.
- Tap ▢ again right as the foot meets the ball for timed finishing (GREEN TIMING is most accurate).
- A free kick in range has a two-man wall. Goal kicks use the same aim/charge/run-up controls: move the target to choose range, use ✕ for a ground pass or ◯ for a lofted delivery; more power delivers it faster. Short passes stay on the ground and target a teammate rather than the goal.

Penalties: a foul inside the 18-yard box gives a penalty from the spot instead of a free kick. Everyone else waits outside the box and the keeper stands on his line. Taking one, you aim and strike exactly as at a free kick (reticle, power, spin, timed finishing); the computer keeper has to guess a side as the ball is struck. The run-up waits until the penalty is ready; a passed penalty is tapped forward. Facing one, you are the keeper: hold the stick left or right to dive that way at the kick, or leave it to stay central.

Goals and woodwork: after a goal the ball carries on into the net, which bulges where it strikes and ripples out. A shot off the post or bar makes the frame shudder with a metallic ring. You also feel these moments: a controller rumbles (Chrome and Edge drive DualSense, DualShock, Xbox and most pads; Firefox where supported), an Android phone vibrates, and on every device the camera gives a short shake, so iPhone and keyboard players feel it too. Vibration can be switched off in Settings › HUD (src/haptics.js).

Fouls and cards: a clean ball-first tackle is legal even from behind. Body-first challenges are judged using contact, the route to the ball and approach speed; a reckless slide can warrant a red. CPU standing tackles jockey when the ball is shielded. A second yellow is a red, and a sent-off player takes no further part.

## Remaining work

The six remaining park scenes are approximations. The supplied LEGONRUSH source contains modeled stadium and Oval scenes but does not expose equivalent standalone models for all those parks. Physics and CPU tactics remain a foundation. Penalty shootout rules, a complete Cup, real-player multiplayer, accounts and shared persistence remain to be built.

## Passing and crossing assistance

Settings → Gameplay → Passing & Crossing offers three saved modes: **Assisted**
corrects aim and weights the delivery for a recipient; **Semi** provides limited
correction while stick direction and held power remain decisive; **Manual**
uses the aiming direction and held power without recipient snapping or automatic
power correction. Hold and release Pass, Through or Lob/Cross to deliver.
See [passing mode behavior and checks](docs/passing-assistance-modes.md).

## Goalkeepers, set pieces and match flow

A loading screen stays up until the venue, all players, every animation and the physics are ready, and lifts on the kickoff view. Keepers always attempt a save: they narrow the angle, rush out one-on-one, dive for wide shots, jump for high ones and block shots struck at them. Saves end as catches, parries (wide or behind for a corner), punches or spills (`src/keeper.js`). When your keeper catches the ball you control him: aim with the movement keys (a yellow ring marks the target, orange when he is marked), tap pass for a rolled throw or hold it for an overarm throw, press through ball or shoot for a long kick, or lob to put the ball down (Switch on touch). Opponents wait outside the box, and the ball is released automatically after six seconds.

CPU ball carriers choose between shooting (aimed away from the keeper, accuracy by difficulty), passing to free teammates, through balls, crosses and dribbling past defenders (`src/cpuBrain.js`). Your AI teammates mark goal-side, one closes down the carrier, and they tackle. Balls over the goal line give corners or goal kicks by last touch; tackles from behind are often fouls and give free kicks, with the defending side kept 7 m away. Players have stamina, shots and long throws show a power bar, and the match has crowd, kick, whistle and goal sounds (toggle in Settings → HUD). The menus play music generated live in `src/music.js` (no audio files, no licence needed): Campus Amapiano (default) or Stadium Anthem, chosen or switched off under Settings → HUD → Menu music. It fades out at kickoff.

## Commentary and player names

Matches have spoken commentary through the device's own voice (Web Speech API), with on-screen captions: no audio files, a few kilobytes of code (`src/commentary.js`). It calls kickoffs, shots, saves, goals with the score, tackles, fouls, corners, throw-ins, half and full time, and build-up play, naming the halls. Goals interrupt anything; minor moments are skipped while the commentator is talking, and the same kind of call is not repeated within ten seconds. Switch it off in Settings → HUD → Commentary.

When the campus game supplies usernames, the commentator uses them for the player on the ball. Pass them with `/?player=Name` (the solo player), `window.MonkeyPostCampus.setPlayerNames({ solo, home, away })`, or a `postMessage` of `{ type: 'monkeypost:players', solo, home, away }`, where `home` and `away` map team slots (0 = keeper, 1-6 outfield) to usernames (`src/players.js`).

## Downloads, versions and updates

The 29 player animations are served as one compact file, `public/animations/clips.json` (about 1 MB compressed), instead of 36 MB of FBX files that each carried a copy of the character. Rebuild it with `python tools/build_clips.py` (dev server running) after adding or changing an animation. The UG Stadium and Athletic Oval GLBs had the parent game's culling data stripped (`node tools/strip_glb_extras.mjs`) and were then meshopt-compressed (`npx @gltf-transform/cli meshopt`): 10.8 MB to 0.46 MB and 6.8 MB to 0.2 MB.

Every build is stamped with its Git commit and build time (`vite.config.js`; Netlify supplies `COMMIT_REF`), shown in Settings and the main menu footer, and published as `/version.json`. An open game checks that file every minute and when the tab regains focus; when a newer build is live, the menus show a "New update available" banner whose button reloads into it. Matches are never interrupted.

## Ball physics and match timing

The match simulates at a fixed 60 Hz (`src/physicsConfig.js`), so it plays at real-time speed on every device; rendering and animation run at the screen's own rate, and render resolution drops automatically on slow devices. Rapier resolves contacts with round posts, the crossbar, players and a net that stops the ball. Spin, curl, drag and rolling are modelled in `src/matchPhysics.js`: air drag with a drag crisis, Magnus curl from side spin, dipping topspin and floating backspin, rolling resistance and bounce grip per surface (astroturf fastest, red earth slowest with uneven bounces). Every constant is in `src/physicsConfig.js` in metres, seconds and kilograms, including kick spin and the CPU settings for Easy, Medium and Hard.

## Match behaviour and team development

Dribbling uses the same facing direction as the rendered character. The ball stays in front through turns, and the carrier's physics capsule does not collide with their own controlled ball. Other players still block loose balls and shots. Running uses the forward jog cycle at a speed matched to movement; striking, backward jogging and goalkeeper distribution clips are not used as outfield running or through-pass animations.

CPU defenders press the exposed ball, can tackle and retain possession, and carry it toward the opposing goal before shooting. Supporting attackers run ahead of possession and into receiving lanes for crosses. Pass receivers run to the intended receiving point rather than chasing an airborne ball underneath its flight.

Both keepers face the ball, predict incoming shots, move laterally for dives, hold catchable balls, and parry or punch harder shots away from their goal before recovering. Catches are held briefly and distributed to a teammate. Goalkeeper shirts have distinct colors.

A completed win improves the selected team's pace, shot power and keeper ability by one percentage point for its next match, capped at 20%. Team wins are stored in this browser on this device; they are not authenticated or shared across devices. Leaving a match, draws and losses do not grant a win. Real-money upgrades are not enabled: they require authenticated player accounts, a payment provider, and server-verified entitlements. Never grant paid upgrades from a client-side payment-success redirect or browser storage.

Run `npm test` for movement, possession, tackles, keeper prediction, physics and progression regression checks, and `npm run build` for the production bundle. Development-only match scenarios are exposed as `window.__footballDebug` when using Vite's development server; they are removed from production builds.

With the Vite development server running, `python tools/smoke_match.py` exercises the real match loop in Chromium: CPU tackle/counterattack, saves by both keepers, holding/distribution, punches, dives, forward runs, keyboard passing/control transfer, halftime/fulltime and saved-win progression. The optional browser check requires Python Playwright and Chromium. It uses an isolated browser context and development-only deterministic scenarios; it does not modify production player data.

`python tools/smoke_physics.py` checks manual shot direction, passing around defenders and CPU trajectories against the development server. For the built game, start `npm run preview -- --port 4173 --strictPort`, then run `FOOTBALL_BASE_URL=http://127.0.0.1:4173 python tools/smoke_physics.py --production` to exercise desktop and emulated phone controls and verify the debug API is absent. See [the physics reference review](docs/physics-reference-review.md) for source links, design decisions and remaining work.

For first-half playtesting, `python tools/audit_first_half.py` exercises match events and plays to halftime at all eight venues; add `--venue sarbah --realtime` for a normal-speed first half. `python tools/check_phone_camera.py` checks the 25% phone zoom, touchline framing and paused rendering. The [gameplay audit log](docs/gameplay-audit-2026-10-20.md) records the reproduced bugs, fixes, validation and publishing status.

`python tools/audit_match_edges.py` replays line-ball retrieval, whole-ball boundary decisions, diagonal corner exits, goalkeeper targeting and interrupted phone gestures at every venue. The [continued gameplay audit](docs/gameplay-audit-round-2-2026-10-20.md) records these corrections and their verification.

## Cloudflare Workers static hosting

This game needs static asset hosting. `wrangler.jsonc` explicitly tells Cloudflare
to publish `dist`, avoiding automatic framework detection trying to parse the
Vite build configuration as a Worker project.

In the connected Cloudflare Git build, keep:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (or `npm run deploy`)
- Worker name: `legon-football-v2`
- Root directory: the repository root

Wrangler is pinned in devDependencies. Cloudflare supplies deployment credentials
for its connected build; no API token belongs in this repository. Check the
configuration locally with `npm run build && npm run deploy:check`. A dry run
validates configuration and packaging; it does not publish to an account.

Cloudflare Workers and custom-domain hosting use the default `/` base path;
leave `VITE_PUBLIC_BASE` unset. The optional `VITE_PUBLIC_BASE` setting supports
repository-path hosting elsewhere. Public models, animations, images and version
checks follow that base. `tools/check_pages_hosting.py` tests a strict static
server, including the Oval venue GLB, and accepts `FOOTBALL_BASE_URL` for either
root or subpath hosting. Static serving must not use a SPA fallback to hide
missing-file requests during this check.

The FBX refers to texture files on its exporter's machine that were never
included in this repository. Those specific unavailable references use material
colour fallbacks instead of making broken requests. Embedded and supplied valid
textures continue to load normally.

After Cloudflare publishes a working `workers.dev` address, connect
`thelegonlive.live` in the Worker's Domains settings. The domain's Cloudflare zone
must be active; if nameservers still point elsewhere, copy Cloudflare's assigned
nameservers into Namecheap Custom DNS while retaining existing email records.
The repository configuration does not change domain registration or DNS.
