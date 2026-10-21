import { LoopOnce, LoopRepeat } from 'three';

// Replaying the same action must not fade that action down to zero: with
// nothing else weighted, the skeleton flashes back to its bind (T) pose.
export function transitionPlayerAction(person, clip, { once = false, duration = clip.duration, natural = false, fade = .17, startPhase = 0 } = {}) {
  const next = person.mixer.clipAction(clip), previous = person.currentAction;
  if (previous && previous !== next) previous.fadeOut(fade);
  next.reset().setEffectiveTimeScale(once && !natural ? clip.duration / duration : 1)
    .setEffectiveWeight(1).setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
  next.time = clip.duration * startPhase;
  next.clampWhenFinished = once;
  if (previous === next) next.stopFading();
  else next.fadeIn(fade);
  next.play(); person.currentAction = next;
  return next;
}
