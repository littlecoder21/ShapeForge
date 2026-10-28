import type { GradientProject } from './model';

/** Duration in milliseconds for the preview to play finite animations, or null when playback should keep looping. */
export function previewDurationMs(project: GradientProject): number | null {
  let longest = 0, found = false;
  for (const layer of project.layers) {
    const animation = layer.anim;
    if (!layer.visible || !animation.enabled || !animation.tracks.length) continue;
    const iterations = animation.iterations ?? 'infinite';
    if (iterations === 'infinite') return null;
    found = true;
    const pointDurations = new Map<string, number>();
    let hasSharedTracks = false;
    for (const track of animation.tracks) {
      if ((track.prop === 'meshX' || track.prop === 'meshY') && track.stopId) {
        if (!pointDurations.has(track.stopId)) pointDurations.set(track.stopId, track.duration ?? animation.duration);
      } else {
        hasSharedTracks = true;
      }
    }
    const durations = [...pointDurations.values(), ...(hasSharedTracks ? [animation.duration] : [])];
    for (const duration of durations) longest = Math.max(longest, Math.max(0, animation.delay + duration * iterations));
  }
  return found ? longest * 1000 : null;
}
