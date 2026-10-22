# Sliding tackles — 2026-10-22

The uploaded eFootball reference shows an approach, an extended foot into the
ball's path, continued sliding after contact, and a separate collision that can
trip the attacker. Its edited sequences are useful movement references, not a
measurement of real-world recovery times. No video or third-party game code is
included in this change.

## Changes

- Preserve running velocity on tackle input. A short entry push blends into
  ground deceleration over the 1.1-second slide; winning the ball does not stop
  that trajectory.
- Lead a nearby moving ball, with at most 0.22 radians of assistance within a
  narrow aiming cone. Deliberately aiming away still misses. Direction remains
  committed after launch. Account for the extended boot's offset beside the
  body centre line when choosing the interception bearing.
- Resample the existing tackle's torso descent into a grounded follow-through.
  Place one extended boot and one tucked boot using the real two-joint legs.
  Select the leg during entry; keep the original bone lengths and boot rotation.
  Hold this grounded pose after a miss and blend the feet through the get-up.
- Replace the forward-offset, 1.35-metre tackle area with swept animated boot
  contacts. The combined boot/ball contact radius is 0.23 metres in 3D. Relative
  sweeps detect fast balls between simulation ticks and reject sideways misses
  and high balls. A loose ball can be tackled without an opponent nearby.
- Compute deflection from the foot-to-ball normal, capped foot speed and incoming
  ball velocity, retaining tangential travel and applying rolling spin. There is
  no fixed pitch-direction push, random lateral kick, ball teleport or automatic
  possession award.
- Sweep the tackler's boots and body against the opponent's animated feet,
  shins, thighs and hips. Body contact follows the animated hip height during
  entry, sliding and descent, rather than placing a ground-level body too early.
  Compare contact order within the tick: body-first forceful challenges produce
  fouls, with yellow/red cards based on approach speed. A later leg/body impact
  can cause a stumble or fall independently of the ball touch. An attacker
  running into a stopped defender does not create a reckless tackle foul.
- Exclude the sliding player's upright physics capsule while animated boots
  resolve the tackle. Restore normal collision when the slide ends. Briefly
  allow the struck ball to leave the former carrier's capsule.
- Use a 1.1-second slide/follow-through and 0.6-second get-up, returning
  control after 1.7 seconds for both clean tackles and misses, with no extra
  prone hold (updated at the user’s request on 2026-10-22). Reject tackles during
  restarts, pending exits and goal resets;
  clear pending kicks and skills when a slide begins.
- Fix the bot's approach around a close shield: its destination now clears the
  carrier and opens a route to the ball, instead of leaving it stuck beside the
  player. Upright standing tackles remain available to bots.

## Verification

Run Vite, then:

```sh
npm test -- --test-isolation=none
python tools/audit_sliding.py
python tools/audit_controller_fixes.py --first-half
python tools/audit_defending_animation.py
python tools/audit_first_half.py --venue sarbah --venue astro --venue oval \
  --output /workspace/slide-fix-audit/first-half
npm run build
WRANGLER_LOG_PATH=/workspace/slide-fix-audit/wrangler.log npm run deploy:check
```

The slide audit checks eight bearings, short/long approaches, contact distance,
continued travel after contact, both wide misses, loose and crossing balls,
high balls, a moving carrier, running entry, body-first fouls/cards, and both
recovery paths on worn, artificial and grass pitches. It saves contact records
and rendered slide/get-up screenshots. Development-only pose diagnostics and
fixture freezing are removed from production builds.

Results: 114 unit tests and 81 slide scenarios pass. In the 48 clean directional
fixtures, first boot contact occurs 0.20–0.383 seconds after input, within the
0.23-metre contact radius; the player continues another 0.765–1.325 metres.
Both wide misses, crossing balls, high-ball rejection, loose balls, a moving
carrier, running entry, body-first yellow/red cards and recovery pass. The
current audit also checks that clean tackles and misses restore control at
1.7 seconds.

First halves complete on Sarbah, Astro and Oval, with 51 event groups passing;
Sarbah also passes after the bot approach correction. Controller charging,
sprints, slide contact, animation clock and halftime navigation pass. The
production build passes desktop keyboard and emulated landscape-phone joystick,
multitouch release and pause/resume checks, with no JavaScript errors or shipped
debug API. Build and Cloudflare packaging pass (51 static files). These are local
browser checks, not a physical-phone performance benchmark.

The bot replay passes 20 opponent and 20 teammate standing-tackle wins, working
around a stationary shield, eight foul/restart groups, and 12 grounded
slide/recovery samples, without JavaScript or shader errors.

Logs and rendered captures: `/workspace/slide-fix-audit/`; the final summary is
`verification.json`. The older recovery
fixture now lets the stationary opponent settle into idle before calling the
ball exposed: an animated boot still extended from the previous test can make
that same root-position setup a body-first challenge.
