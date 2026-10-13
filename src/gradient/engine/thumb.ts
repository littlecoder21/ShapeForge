import type { GradientProject } from './model';

/** Scale a project down to a thumbnail width: px values (blur, repeat period, circle radius) shrink with the canvas. */
export function thumbProject(p: GradientProject, width: number): GradientProject {
  const k = width / p.canvas.w;
  return {
    ...p, canvas: { w: Math.round(width), h: Math.round(p.canvas.h * k) },
    layers: p.layers.map(l => ({
      ...l,
      repeat: l.repeat.unit === 'px' ? { ...l.repeat, size: l.repeat.size * k, offset: l.repeat.offset * k } : l.repeat,
      effects: l.effects.map(e => ({ ...e, params: { ...e.params, ...(e.type === 'blur' ? { radius: e.params.radius * k } : {}), ...(e.type === 'distort' ? { scale: e.params.scale * k, freq: e.params.freq / k } : {}) } })),
      anim: { ...l.anim, enabled: false },
    })),
  };
}
