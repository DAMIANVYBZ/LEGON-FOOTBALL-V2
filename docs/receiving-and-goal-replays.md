# Receiving, throw-ins and goal presentation

Receiving combines 60% normalized player input with 40% AI input. With no
movement input the player gently approaches the incoming ball; a full movement
away from it still takes priority. Assistance moves the player through the same
acceleration/braking model as normal movement. It never pulls or teleports the
ball, grants possession at a distance, or changes first-touch eligibility.

The intended receiver runs toward a forecast interception point. Before contact,
control transfers to that receiver once they can reach the interception with the
assisted movement available. Close, approaching balls can hand over sooner.
Forecasts include drag, spin, gravity, landing grip and rolling resistance and
refresh at 10 Hz. Assistance ends on possession, an opponent's touch/possession,
a restart, timeout, slide or knockdown. Player lock and manual keeper control
retain their existing control selection. Ordinary passes, through passes,
crosses, corners, free kicks, goal kicks and throw-ins share this receiving path.
Corner attackers stay in the box unless a short corner is selected.

Throw-ins now use an aiming reticle, curved dotted flight guide and held-button
power. Move the joystick, movement keys or left stick to aim; hold PASS, then
release to throw. The reticle stays inside the pitch and within 22 metres. The
throw comes from 1.8 metres, with the taker stationary outside the touchline.
The guide and release use the same launch solver; power changes the flight's
pace and arc. CPU throw-ins use the same launch model. Throw-in offside
exemptions, direct-goal restrictions and double-touch rules still apply.

After a goal, the scorer celebrates for up to six seconds. The five available
outfield teammates run into distinct positions around the scorer, then join the
celebration. Sent-off players and the goalkeeper are excluded. The match clock
stops during celebration and replay.

A bounded 30 Hz history stores the recent ball trajectory, player movement,
animation phase and visibility. The goal's net follow-through is included.
Playback interpolates that recorded action at 90% speed from three cameras:
broadcast, behind the goal and behind the attack. Playback does not simulate a
second goal or alter score, possession, stamina or match time. It runs inside
the game; no video download or external video service is required.

SKIP CELEBRATION starts the replay. SKIP REPLAY returns directly to kickoff for
the conceding team. Both controls work by touch/click, Enter/Space, or a primary
gamepad action. Pause holds the current replay position. Held gameplay actions
are cleared at transitions so skipping cannot accidentally pass or shoot at
kickoff. No second half starts automatically.

## Replaying the checks

With Vite running on port 5173 and Chromium/Playwright installed:

```
npm test -- --test-isolation=none
python tools/audit_receiving.py
python tools/audit_goal_replay.py
python tools/audit_first_half.py --venue sarbah --venue astro --venue oval --output /workspace/receiving-audit/halves
npm run build
npm run deploy:check
```

The receiving audit checks 60/40 assistance on desktop and phone for eight
delivery types, including headers from crosses, small manual corrections,
assistance stopping after contact, both throw-in touchlines, two power levels,
and agreement between the guide and actual flight. The goal audit checks home
and away scorers, teammates approaching, three moving replay angles, unchanged
score/time, automatic kickoff, independent skip controls and pause/resume.
Development inspection helpers are excluded from production builds.
