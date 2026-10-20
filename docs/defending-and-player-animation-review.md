# Defending and player animation review

The reported repeated bot slides were ordinary CPU tackle attempts playing
`SOCCER-TACKLE`, not a separate tactical slide decision. The normal and
alternate slide assets contain identical tracks. Playing this 2.73-second move
in 0.55 seconds made the avatar drop and stand almost immediately. CPU checks
also started this animation outside the tighter ball-winning reach. Home AI
helpers additionally rolled a random failure after reaching an exposed ball.

## Changes

- CPU outfield tackles use the upright foot-poke animation and only start when
  the ball is reachable. Clean, unblocked helper tackles no longer randomly
  fail. Body shielding and foul checks still apply.
- The primary defender works around a shield to reach the exposed side; the
  supporting defender contains from the goal side. Close-down movement uses
  arrival braking and smaller stopping margins, avoiding a dead zone just
  outside tackle reach.
- Restarting the same animation no longer fades its own weight to zero. That
  exposed the unanimated bind pose instead of blending between moves.
- Genuine slides use the grounded part of the authored clip, with an explicit
  decelerating ground lunge. This avoids playing its baked get-up and then
  abruptly returning to a fallen pose. Switching is blocked during the lunge.
- Get-up playback is half its previous speed: 2.2 seconds instead of 1.1.
  Missed-slide recovery is 4.8 seconds instead of 2.4, including the get-up.
  Successful slides enter the same slow get-up immediately after the slide
  rather than serving the extra missed-slide ground hold. Recovering players
  cannot move or regain control of the ball while on the ground.
- Player materials now preserve the original skin/face, boot, clothing and
  normal textures. Kit colours use luminance from the original atlas so the
  original red shirt does not multiply into other teams' colours. Materials
  distinguish fabric, skin and boots; shadow bias reduces surface acne.

This improves the existing player's detail and animation continuity; it does
not replace the mesh or create distinct high-resolution faces for every player.
Google Research Football's native animation engine has not been run here.

## Verification

- 77 unit tests, including a repeated-action bind-pose regression and material
  texture preservation.
- Browser fixtures: 20 opponent and 20 teammate exposed-ball wins with upright
  pokes; a defender works around a stationary shield without a foul.
- Twelve real skeleton/mesh-bound samples through slide, ground hold and
  standing. The player remains visible; movement input cannot move him during
  recovery. A successful slide wins the ball and still requires getting up.
- Existing foul and restart fixtures, and full-match browser checks covering
  defensive takeover/counterattack, passing, headers, keepers, halves and saved
  results. Production build and keyboard/touch controls checked separately.

Replay evidence is saved outside the checkout in
`/workspace/playtest-artifacts/defending-animation`. Browser screenshots show
controlled fixtures, not an uninterrupted real match. External font requests
can be blocked by the environment; local assets and shaders must succeed.

Publishing uses GitHub main and the connected Netlify build. Direct access to
Netlify remains blocked by the environment proxy, so a successful push does not
by itself verify that Netlify has published the new build.
