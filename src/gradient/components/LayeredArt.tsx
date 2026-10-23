import { memo, useMemo } from 'react';
import { effectDefs, layerCss, stableNames } from '../engine/css';
import type { GradientLayer, GradientProject } from '../engine/model';

/** One <style> per layer: React only rewrites the style of the layer that actually changed, so dragging a handle on one
 *  layer never forces the browser to re-rasterise (blur!) the others. */
const LayerStyle = memo(function LayerStyle({ layer, canvas, rootSel, scope }: { layer: GradientLayer; canvas: GradientProject['canvas']; rootSel: string; scope: string }) {
  const css = useMemo(() => layerCss(layer, { canvas } as GradientProject, { rootSel, names: { ...stableNames, scope } }), [layer, canvas, rootSel, scope]);
  return <style>{css}</style>;
});

interface Props { project: GradientProject; rootClass: string; playing?: boolean; className?: string; testId?: string }

/** The live DOM composition of a project — the same CSS the Output panel exports, scoped to `.rootClass`. */
function LayeredArt({ project, rootClass, playing = false, className = '', testId }: Props) {
  const visible = project.layers.filter(l => l.visible);
  const effectKey = JSON.stringify([project.canvas, visible.map(l => [l.id, l.effects, l.type === 'mesh' ? l.mesh.points.map(point => point.effects) : []])]);
  const names = { ...stableNames, scope: rootClass };
  const defs = useMemo(() => effectDefs(project, names), [effectKey, rootClass]);
  const rootSel = `.${rootClass}`;
  return <div className={`${rootClass} gs-art-root${playing ? ' gs-play' : ''} ${className}`} style={{ backgroundColor: project.background || undefined }} data-testid={testId}>
    {visible.map(l => <LayerStyle key={l.id} layer={l} canvas={project.canvas} rootSel={rootSel} scope={rootClass} />)}
    {[...visible].reverse().map(l => <i key={l.id} className={`g-layer g-${l.id}`}>
      {l.type === 'mesh' && [...l.mesh.points].map((point, index) => ({ point, index })).reverse().map(({ point, index }) => <i key={point.id} className={`mesh-point-${index}`} />)}
    </i>)}
    {defs && <svg width="0" height="0" style={{ position: 'absolute' }}><defs dangerouslySetInnerHTML={{ __html: defs }} /></svg>}
  </div>;
}
export default memo(LayeredArt);
