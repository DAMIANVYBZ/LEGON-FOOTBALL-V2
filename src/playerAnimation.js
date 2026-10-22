import { AnimationClip, LoopOnce, LoopRepeat } from 'three';

// The source tackle contains a running entry, a scissoring fall and a get-up.
// Retain its torso descent, then hold the grounded pose. Feet are placed by
// the two-joint slide reach; recovery uses the separate slowed stand clip.
export function groundedSlideClip(source) {
  const times = [0, .12, .28, .42, 1.1], poses = [.3, .6, 1, 1.2, 1.2];
  return new AnimationClip('grounded-slide', 1.1, source.tracks.map(track => {
    const result = track.clone(), interpolant = track.createInterpolant();
    result.times = new Float32Array(times);
    result.values = new Float32Array(poses.flatMap(time => Array.from(interpolant.evaluate(time))));
    return result;
  }));
}

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
