import { RIG_FALLOFF_FN, type RigRule } from '../../interactive/rig/model';

type FadeFields = Pick<RigRule, 'falloff' | 'fadeStart' | 'fadeWidth' | 'fadePower' | 'fadeSoftness' | 'fadeOpacity' | 'fadeInvert' | 'fadeMode'>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const WIDTH = 200;
const HEIGHT = 64;
/** the chart covers distances 0 … 1.6 of the rule radius */
const RANGE = 1.6;

/** The influence of a rule at a distance from its centre, the way the shader computes it (rig/glsl.ts `weightFunction`). */
export function fadeProfile(rule: FadeFields, distance: number): number {
  let q = clamp((distance - rule.fadeStart) / Math.max(rule.fadeWidth - rule.fadeStart, 0.05), 0, 1);
  q = Math.pow(q, Math.max(rule.fadePower, 0.1));
  q += (q * q * (3 - 2 * q) - q) * rule.fadeSoftness;
  let weight = RIG_FALLOFF_FN[rule.falloff](q);
  if (rule.fadeInvert) weight = 1 - weight;
  return clamp(weight * rule.fadeOpacity, 0, 1);
}

/** Live preview of the whole fade builder: start, extent, curve power, softness, strength, invert and falloff in one curve.
 *  It redraws on every slider tick, so the effect of a control is visible before the preview even catches up. */
export default function FadeChart({ rule }: { rule: FadeFields }) {
  const steps = 64;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const distance = RANGE * i / steps;
    return `${(i / steps * WIDTH).toFixed(1)},${(HEIGHT - 4 - fadeProfile(rule, distance) * (HEIGHT - 8)).toFixed(1)}`;
  });
  const edgeX = WIDTH / RANGE;
  return <figure style={{ margin: '4px 0 8px' }} data-testid="rig-fade-chart">
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Influence from the centre outwards" style={{ display: 'block', width: '100%', height: HEIGHT, borderRadius: 8, background: 'rgba(255,255,255,.04)' }}>
      <line x1={edgeX} y1="0" x2={edgeX} y2={HEIGHT} stroke="rgba(255,255,255,.22)" strokeDasharray="3 3" />
      <polyline points={`0,${HEIGHT} ${points.join(' ')} ${WIDTH},${HEIGHT}`} fill="rgba(105,223,181,.16)" stroke="none" />
      <polyline points={points.join(' ')} fill="none" stroke="#69dfb5" strokeWidth="2" strokeLinejoin="round" />
    </svg>
    <figcaption className="hint" style={{ marginTop: 2 }}>
      Influence from the centre (left) outwards; the dashed line is the radius.{rule.fadeMode !== 'radial' ? ' The fade direction adds a ramp across the shape on top of this curve.' : ''}
    </figcaption>
  </figure>;
}
