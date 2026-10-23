import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import { gradientFn } from '../engine/css';
import { BLEND_MODES, cloneLayer, newSolidLayer, type GradientLayer, type GradientProject } from '../engine/model';
import { SOLID_SWATCHES, setSolidColor } from '../engine/solidColors';
import { useStore } from '../engine/store';
import { LAYER_TEMPLATES, typeIcon } from '../engine/templates';
import { ValueControl } from '../../shared/controls';
import LayerCssPanel from './LayerCssPanel';
import { ColorInput, useStudio } from './ui';

const ROW = 54;

function LayerThumb({ layer }: { layer: GradientLayer }) {
  const bg = gradientFn({ ...layer, repeating: layer.repeating, anim: { ...layer.anim, enabled: false } }, { canvas: { w: 120, h: 80 } } as GradientProject, { flat: true });
  return <span className="gs-lthumb" style={{ backgroundImage: bg }} />;
}

export default function LayersPanel({ onSelected }: { onSelected?: () => void }) {
  const { store, announce } = useStudio();
  const layers = useStore(store, s => s.project.layers);
  const layerId = useStore(store, s => s.layerId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dy, setDy] = useState(0);
  const start = useRef({ y: 0, index: 0 });

  const selected = layers.find(l => l.id === layerId) ?? null;
  const select = (id: string) => { store.select(id); onSelected?.(); };
  const add = (make: () => GradientLayer) => { const l = make(); store.update(p => ({ ...p, layers: [l, ...p.layers] })); store.select(l.id); announce(`Added ${l.name}`); };
  const move = (id: string, to: number) => store.update(p => { const i = p.layers.findIndex(l => l.id === id); if (i < 0 || to < 0 || to >= p.layers.length || i === to) return p; const a = [...p.layers]; const [x] = a.splice(i, 1); a.splice(to, 0, x); return { ...p, layers: a }; });
  const dup = (l: GradientLayer) => { const c = cloneLayer(l); c.name = `${l.name} copy`; store.update(p => ({ ...p, layers: p.layers.flatMap(x => (x.id === l.id ? [c, x] : [x])) })); store.select(c.id); };
  const del = (l: GradientLayer) => {
    if (layers.length === 1) {
      const base = newSolidLayer();
      store.update(p => ({ ...p, layers: [base] }));
      store.select(base.id);
      announce('Replaced final layer with a solid color layer');
      return;
    }
    const i = layers.findIndex(x => x.id === l.id), nextId = layers[i + 1]?.id ?? layers[i - 1]?.id ?? null;
    store.update(p => ({ ...p, layers: p.layers.filter(x => x.id !== l.id) })); store.select(nextId);
  };
  const toggle = (l: GradientLayer) => store.updateLayer(l.id, { visible: !l.visible });

  const gripDown = (e: RPointerEvent, l: GradientLayer, index: number) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); start.current = { y: e.clientY, index }; setDragId(l.id); setDy(0); };
  const gripMove = (e: RPointerEvent) => { if (dragId) setDy(e.clientY - start.current.y); };
  const gripUp = () => {
    if (!dragId) return;
    const to = Math.max(0, Math.min(layers.length - 1, start.current.index + Math.round(dy / ROW)));
    move(dragId, to); setDragId(null); setDy(0);
  };

  return <div className="gs-layers" data-testid="layers-panel">
    <div className="gs-chips gs-addchips" role="group" aria-label="Add layer">
      {LAYER_TEMPLATES.map(t => <button key={t.id} type="button" className="chip" onClick={() => add(t.make)} data-testid={`add-layer-${t.id}`}>+ {t.label}</button>)}
    </div>
    <ul className="gs-layerlist" style={{ height: layers.length * ROW }}>
      {layers.map((l, i) => {
        const dragging = dragId === l.id;
        const target = dragId ? Math.max(0, Math.min(layers.length - 1, start.current.index + Math.round(dy / ROW))) : -1;
        const dragIndex = dragId ? start.current.index : -1;
        let y = i * ROW;
        if (dragging) y = Math.max(0, Math.min((layers.length - 1) * ROW, start.current.index * ROW + dy));
        else if (dragId) { if (dragIndex < target && i > dragIndex && i <= target) y = (i - 1) * ROW; else if (dragIndex > target && i < dragIndex && i >= target) y = (i + 1) * ROW; }
        return <li key={l.id} className={`gs-layer ${l.id === layerId ? 'sel' : ''} ${!l.visible ? 'off' : ''} ${dragging ? 'drag' : ''}`} style={{ transform: `translateY(${y}px)`, height: ROW - 4 }} data-testid="layer-row">
          <button type="button" className="gs-eye" onClick={() => toggle(l)} aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} aria-pressed={l.visible} data-testid="layer-eye">{l.visible ? <Eye /> : <EyeOff />}</button>
          <button type="button" className="gs-layerbtn" onClick={() => select(l.id)} aria-label={`Select ${l.name}`} aria-current={l.id === layerId} data-testid="layer-select">
            <LayerThumb layer={l} />
            <span className="gs-lname">{l.name}<small>{l.solidColor !== undefined ? '■' : typeIcon[l.type]} {l.solidColor !== undefined ? 'solid color' : `${l.repeating ? 'repeating ' : ''}${l.type}`}{l.blend !== 'normal' ? ` · ${l.blend}` : ''}{l.opacity < 1 ? ` · ${Math.round(l.opacity * 100)}%` : ''}</small></span>
          </button>
          <span className="gs-lact">
            {l.id === layerId && <>
              <button type="button" onClick={() => move(l.id, i - 1)} disabled={i === 0} aria-label="Move layer up" data-testid="layer-up"><ArrowUp /></button>
              <button type="button" onClick={() => move(l.id, i + 1)} disabled={i === layers.length - 1} aria-label="Move layer down" data-testid="layer-down"><ArrowDown /></button>
              <button type="button" onClick={() => dup(l)} aria-label="Duplicate layer" data-testid="layer-dup"><Copy /></button>
              <button type="button" onClick={() => del(l)} aria-label="Delete layer" data-testid="layer-del"><Trash2 /></button>
            </>}
          </span>
          <span className="gs-grip" onPointerDown={e => gripDown(e, l, i)} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp} aria-label="Drag to reorder" role="button" tabIndex={-1}><GripVertical /></span>
        </li>;
      })}
    </ul>
    <p className="gs-bar-hint">Top of the list = top of the stack.</p>
    {selected && <div className="gs-quick" data-testid="layer-quick">
      {selected.solidColor !== undefined && <div>
        <div className="field-label">Solid color</div>
        <ColorInput
          color={selected.solidColor}
          alpha={1}
          showAlpha={false}
          onChange={color => store.updateLayer(selected.id, layer => setSolidColor(layer, color), { coalesce: 'solid-color' })}
          label="Solid color"
          testId="solid-color"
        />
        <div className="chips wrap" role="group" aria-label="Solid color swatches">
          {SOLID_SWATCHES.map(swatch => <button
            key={swatch.id}
            type="button"
            className={`chip ${selected.solidColor === swatch.color ? 'active' : ''}`}
            onClick={() => store.updateLayer(selected.id, layer => setSolidColor(layer, swatch.color))}
            aria-label={`Set solid color to ${swatch.label}`}
            title={swatch.label}
            data-testid={`solid-swatch-${swatch.id}`}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, marginRight: 6, borderRadius: 3, background: swatch.color, border: '1px solid rgba(128,128,128,.5)', verticalAlign: '-1px' }} />{swatch.label}
          </button>)}
        </div>
      </div>}
      <label className="nf"><span className="nf-label">Blend mode</span><select className="generate-select" value={selected.blend} onChange={e => store.updateLayer(selected.id, { blend: e.target.value as GradientLayer['blend'] })} data-testid="quick-blend" aria-label="Blend mode">{BLEND_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
      <ValueControl label="Opacity" value={Math.round(selected.opacity * 100)} min={0} max={100} unit="%" def={100} onChange={v => store.updateLayer(selected.id, { opacity: v / 100 }, { coalesce: 'opacity' })} testId="quick-opacity" />
    </div>}
    <LayerCssPanel />
  </div>;
}
