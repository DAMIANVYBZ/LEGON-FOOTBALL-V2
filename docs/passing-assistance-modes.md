# Passing and crossing modes

Choose Settings → Gameplay → Passing & Crossing. The choice is saved on the
device and restored when opening the game again. Existing preferences default
to Assisted. Keyboard, gamepad and touch use the same selected behavior.

| Mode | Aim | Power |
| --- | --- | --- |
| Assisted | Select and lead a recipient, or place a cross into the aimed box zone. | Weight the ball for the recipient's distance and the pitch surface. |
| Semi | Select teammates within the aimed lane and charge-dependent reach; correct the bearing partially, by no more than about six degrees. | Mostly held-button power, with partial correction for recipient distance. |
| Manual | Use the aiming direction directly, without recipient snapping or automatic side curl. | Ground speed, loft speed and elevation come directly from held power. |

Semi blends 30% target correction into aim and power. Charge also affects which
nearer or further teammate is selected. A poorly aimed Semi delivery can miss;
its receiving destination follows its actual partially corrected direction.
Manual does not use teammates, marking, team ability or automatic distance
weighting to change the launch. Gravity, drag, spin, surface resistance and
collisions still affect the ball after release.

The setting covers short passes, through passes, lobs/crosses, goalkeeper
rolls/throws and passing deliveries at corners, free kicks and goal kicks.
Direct shots and penalties retain their shooting controls. Set-piece guides use
the selected delivery calculation; Semi/Manual aim and power are locked at
button release. Throw-ins retain their existing aimed overhead throw controls.
Receiving guidance remains a separate 70% setting for tracked incoming balls.

Hold and release PASS, THROUGH or LOB/CROSS to deliver. Through passes now use
held power and release, including the gamepad triangle/Y button. Pause, blur,
cancel and restart clear held through-pass input, just like ordinary passes.

## Verification

```
npm test -- --test-isolation=none
python tools/audit_passing_modes.py
python tools/audit_passing_modes.py --native-only
python tools/audit_receiving.py
python tools/audit_moving_pass.py
python tools/audit_controller_fixes.py --first-half
npm run build
npm run deploy:check
```

The mode audit changes the real Settings radio controls, reloads the settings,
starts a fresh match, and checks all modes on desktop and phone. Fixtures check
launch bearing, charge sensitivity, automatic distance weighting, lofted crosses,
through-pass cancellation, keeper distributions and pass/cross guides at three
restart types. Manual trajectories are checked for independence from teammate
positions, and Semi for its limited aiming correction.
The native-input checks exercise held keyboard through passes, controller
stick/triangle input and a charged two-finger phone pass without an aim override.
