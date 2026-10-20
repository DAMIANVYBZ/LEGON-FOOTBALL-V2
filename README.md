# Monkey Post — campus football module

This playable football subgame uses React, Three.js and Vite. It is designed to launch from the LEGONRUSH university lifestyle and bike-racing game when its avatar walks or rides to a campus football location. The original Monkey Post source is unavailable. The supplied LEGONRUSH source was inspected and used for the stadium and Oval scene exports, hall colors and verified field coordinates; the parent source itself stays in its separate repository.

## Run

```sh
npm install
npm run dev
```

`npm run build` produces the static `dist/` folder.

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

## Remaining work

The six remaining park scenes are approximations. The supplied LEGONRUSH source contains modeled stadium and Oval scenes but does not expose equivalent standalone models for all those parks. Physics and CPU tactics remain a foundation. Penalty shootout rules, a complete Cup, real-player multiplayer, gamepad support, sound, accounts and shared persistence remain to be built.

## Goalkeepers, set pieces and match flow

A loading screen stays up until the venue, all players, every animation and the physics are ready, and lifts on the kickoff view. Keepers always attempt a save: they narrow the angle, rush out one-on-one, dive for wide shots, jump for high ones and block shots struck at them. Saves end as catches, parries (wide or behind for a corner), punches or spills (`src/keeper.js`). When your keeper catches the ball you control him: aim with the movement keys (a yellow ring marks the target, orange when he is marked), tap pass for a rolled throw or hold it for an overarm throw, press through ball or shoot for a long kick, or lob to put the ball down (Switch on touch). Opponents wait outside the box, and the ball is released automatically after six seconds.

CPU ball carriers choose between shooting (aimed away from the keeper, accuracy by difficulty), passing to free teammates, through balls, crosses and dribbling past defenders (`src/cpuBrain.js`). Your AI teammates mark goal-side, one closes down the carrier, and they tackle. Balls over the goal line give corners or goal kicks by last touch; tackles from behind are often fouls and give free kicks, with the defending side kept 7 m away. Players have stamina, shots and long throws show a power bar, and the match has crowd, kick, whistle and goal sounds (toggle in Settings → HUD). The menus play music generated live in `src/music.js` (no audio files, no licence needed): Campus Amapiano (default) or Stadium Anthem, chosen or switched off under Settings → HUD → Menu music. It fades out at kickoff.

## Ball physics and match timing

The match simulates at a fixed 60 Hz (`src/physicsConfig.js`), so it plays at real-time speed on every device; rendering and animation run at the screen's own rate, and render resolution drops automatically on slow devices. Rapier resolves contacts with round posts, the crossbar, players and a net that stops the ball. Spin, curl, drag and rolling are modelled in `src/matchPhysics.js`: air drag with a drag crisis, Magnus curl from side spin, dipping topspin and floating backspin, rolling resistance and bounce grip per surface (astroturf fastest, red earth slowest with uneven bounces). Every constant is in `src/physicsConfig.js` in metres, seconds and kilograms, including kick spin and the CPU settings for Easy, Medium and Hard.

## Match behaviour and team development

Dribbling uses the same facing direction as the rendered character. The ball stays in front through turns, and the carrier's physics capsule does not collide with their own controlled ball. Other players still block loose balls and shots. Running uses the forward jog cycle at a speed matched to movement; striking, backward jogging and goalkeeper distribution clips are not used as outfield running or through-pass animations.

CPU defenders press the exposed ball, can tackle and retain possession, and carry it toward the opposing goal before shooting. Supporting attackers run ahead of possession and into receiving lanes for crosses. Pass receivers run to the intended receiving point rather than chasing an airborne ball underneath its flight.

Both keepers face the ball, predict incoming shots, move laterally for dives, hold catchable balls, and parry or punch harder shots away from their goal before recovering. Catches are held briefly and distributed to a teammate. Goalkeeper shirts have distinct colors.

A completed win improves the selected team's pace, shot power and keeper ability by one percentage point for its next match, capped at 20%. Team wins are stored in this browser on this device; they are not authenticated or shared across devices. Leaving a match, draws and losses do not grant a win. Real-money upgrades are not enabled: they require authenticated player accounts, a payment provider, and server-verified entitlements. Never grant paid upgrades from a client-side payment-success redirect or browser storage.

Run `npm test` for movement, possession, tackles, keeper prediction, physics and progression regression checks, and `npm run build` for the production bundle. Development-only match scenarios are exposed as `window.__footballDebug` when using Vite's development server; they are removed from production builds.

With the Vite development server running, `python tools/smoke_match.py` exercises the real match loop in Chromium: CPU tackle/counterattack, saves by both keepers, holding/distribution, punches, dives, forward runs, keyboard passing/control transfer, halftime/fulltime and saved-win progression. The optional browser check requires Python Playwright and Chromium. It uses an isolated browser context and development-only deterministic scenarios; it does not modify production player data.
