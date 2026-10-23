import { useRef, useState } from 'react';
import { Copy, ImageUp, Lock, Plus, RotateCcw, Shuffle, Trash2, Unlock } from 'lucide-react';
import { Section, Seg, Switch, ValueControl } from '../../shared/controls';
import { EFFECTS, EFFECT_LIST, newEffect } from '../engine/effects';
import { hslToHex, hexToHsl, rgbToHex } from '../engine/color';
import { generateMesh, meshLayout, MESH_PATTERNS, newMeshPoint, type MeshPattern } from '../engine/mesh';
import { IDENTITY, uid, type GradientLayer, type MeshPoint } from '../engine/model';
import { mulberry } from '../engine/rng';
import { useStore } from '../engine/store';
import { ColorInput, useStudio } from './ui';

const PALETTES: [string, string[]][] = [
  ['Candy', ['#ff7ad9', '#7c5cff', '#22d3ee', '#fbbf24']], ['Aurora', ['#34f5a1', '#22d3ee', '#a78bfa', '#0ea5e9']], ['Sunset', ['#ff6b6b', '#ffb36b', '#c084fc', '#f472b6']],
  ['Ocean', ['#0ea5e9', '#22d3ee', '#6366f1', '#14b8a6']], ['Peach', ['#ffd1ba', '#ffb4a2', '#e5989b', '#b5838d']], ['Mono', ['#e5e7eb', '#9ca3af', '#4b5563', '#111827']],
];
type Harmony = 'complementary' | 'analogous' | 'split' | 'monochromatic';
const harmonyOptions: { id: Harmony; label: string }[] = [
  { id: 'complementary', label: 'Complementary' }, { id: 'analogous', label: 'Analogous' },
  { id: 'split', label: 'Split' }, { id: 'monochromatic', label: 'Mono' },
];
function harmonyPalette(color: string, harmony: Harmony, count: number) {
  const { h, s, l } = hexToHsl(color);
  return Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 0 : i / (count - 1);
    if (harmony === 'monochromatic') return hslToHex(h, Math.max(16, Math.min(100, s * (0.65 + t * 0.5))), Math.max(12, Math.min(88, l * (0.55 + t * 0.9))));
    const hue = harmony === 'complementary' ? h + (i % 2) * 180
      : harmony === 'split' ? h + [0, 150, 210][i % 3]
        : h + (t - 0.5) * 70;
    return hslToHex(hue, s, l);
  });
}
const keepPointSettings = (fresh: MeshPoint[], previous: MeshPoint[]) => fresh.map((point, i) => {
  const old = previous[i];
  return old ? {
    ...point,
    id: old.id,
    x: old.locked ? old.x : point.x,
    y: old.locked ? old.y : point.y,
    alpha: old.alpha,
    size: old.size,
    core: old.core,
    locked: old.locked,
    group: old.group,
    transform: old.transform ? { ...old.transform } : undefined,
    effects: old.effects?.map(effect => ({ ...effect, params: { ...effect.params } })),
  } : point;
});

/** Mesh layer controls — the points themselves are dragged on the canvas (double-tap empty canvas to add one). */
export default function MeshPanel({ layerId }: { layerId: string }) {
  const { store, announce } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  const selId = useStore(store, s => s.stopId);
  const [pattern, setPattern] = useState<MeshPattern>('scatter');
  const [harmony, setHarmony] = useState<Harmony>('complementary');
  const imageInput = useRef<HTMLInputElement>(null);
  if (!layer || layer.type !== 'mesh') return null;
  const pts = layer.mesh.points, sel = pts.find(p => p.id === selId) ?? null, seed = layer.mesh.seed ?? 7;

  const setMesh = (fn: (m: GradientLayer['mesh']) => GradientLayer['mesh'], key?: string) => store.updateLayer(layerId, l => ({ ...l, mesh: fn(l.mesh) }), { coalesce: key });
  const sliderGesture = { onBegin: () => store.begin(), onCommit: () => store.end() };
  const setPt = (id: string, p: Partial<MeshPoint>, key?: string) => setMesh(m => ({ ...m, points: m.points.map(x => (x.id === id ? { ...x, ...p } : x)) }), key);
  const add = () => {
    const rnd = mulberry(seed * 7919 + pts.length + 1);
    const np = newMeshPoint(15 + rnd() * 70, 15 + rnd() * 70, hslToHex(rnd() * 360, 80, 60), 1, 46);
    setMesh(m => ({ ...m, points: [...m.points, np] }));
    store.selectStop(np.id);
  };
  const remove = () => { if (!sel) return; if (pts.length <= 1) { announce('Keep at least one point'); return; } setMesh(m => ({ ...m, points: m.points.filter(x => x.id !== sel.id) })); store.selectStop(null); };
  const dup = () => { if (!sel) return; const c = { ...sel, id: uid('m'), x: Math.min(100, sel.x + 6), y: Math.min(100, sel.y + 6), locked: false, transform: sel.transform ? { ...sel.transform } : undefined, effects: sel.effects?.map(effect => ({ ...effect, id: uid('e'), params: { ...effect.params } })) }; setMesh(m => ({ ...m, points: [...m.points, c] })); store.selectStop(c.id); };
  const palette = (cols: string[]) => setMesh(m => ({ ...m, points: m.points.map((p, i) => ({ ...p, color: cols[i % cols.length] })) }));
  const relayout = (pat: MeshPattern, sd: number) => {
    const positions = meshLayout(pts.length, pat, sd);
    setMesh(m => ({ ...m, seed: sd, points: m.points.map((p, i) => p.locked ? p : ({ ...p, x: Math.round(positions[i].x * 10) / 10, y: Math.round(positions[i].y * 10) / 10 })) }));
  };
  const regenerate = (count: number) => {
    const colors = pts.map(p => p.color);
    setMesh(m => {
      const generated = generateMesh(colors.length ? colors : ['#7c5cff', '#22d3ee'], count, pattern, seed, m.base, 50);
      return { ...generated, points: keepPointSettings(generated.points, m.points), core: m.core };
    });
  };
  const randomize = () => {
    const nextSeed = seed >= 999 ? 1 : seed + 1, rnd = mulberry(nextSeed * 7919);
    const colors = Array.from({ length: Math.max(pts.length, 2) }, () => hslToHex(rnd() * 360, 80, 60));
    setMesh(m => {
      const generated = generateMesh(colors, m.points.length, pattern, nextSeed, m.base, 50);
      return { ...generated, points: keepPointSettings(generated.points, m.points), core: m.core };
    });
  };
  const suggested = harmonyPalette(sel?.color ?? '#7c5cff', harmony, Math.max(pts.length, 2));
  const applyHarmony = () => setMesh(m => ({
    ...m,
    points: m.points.map((point, i) => (!sel?.group || point.group === sel.group) ? { ...point, color: suggested[i % suggested.length] } : point),
  }));
  const importImage = async (file?: File) => {
    if (!file) return;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Image sampling is unavailable in this browser');
      const scale = Math.min(128 / bitmap.width, 128 / bitmap.height);
      const width = bitmap.width * scale, height = bitmap.height * scale;
      context.drawImage(bitmap, (128 - width) / 2, (128 - height) / 2, width, height);
      const pixels = context.getImageData(0, 0, 128, 128).data;
      const count = Math.max(2, Math.min(12, pts.length || 8));
      const positions = meshLayout(count, 'grid', seed);
      const sample = (x: number, y: number) => {
        const cx = Math.round((x / 100) * 127), cy = Math.round((y / 100) * 127), sums = [0, 0, 0];
        let n = 0;
        for (let py = Math.max(0, cy - 4); py <= Math.min(127, cy + 4); py++) for (let px = Math.max(0, cx - 4); px <= Math.min(127, cx + 4); px++) {
          const index = (py * 128 + px) * 4, alpha = pixels[index + 3] / 255;
          if (alpha < 0.05) continue;
          sums[0] += pixels[index] * alpha; sums[1] += pixels[index + 1] * alpha; sums[2] += pixels[index + 2] * alpha; n += alpha;
        }
        return n ? rgbToHex({ r: sums[0] / n, g: sums[1] / n, b: sums[2] / n }) : '#ffffff';
      };
      const points = positions.map((position, index) => {
        const old = pts[index];
        return {
          id: old?.id ?? uid('m'), ...position, color: sample(position.x, position.y),
          alpha: 1, size: old?.size ?? 54, core: old?.core, locked: false, group: old?.group,
          transform: old?.transform ? { ...old.transform } : undefined,
          effects: old?.effects?.map(effect => ({ ...effect, params: { ...effect.params } })),
        };
      });
      setMesh(m => ({ ...m, seed, points }));
      if (points[0]) store.selectStop(points[0].id);
      announce(`Sampled ${points.length} editable mesh points from ${file.name}`);
    } catch (error) {
      announce(error instanceof Error ? `Image sampling failed: ${error.message}` : 'Image sampling failed');
    } finally {
      bitmap?.close();
      if (imageInput.current) imageInput.current.value = '';
    }
  };
  const setFx = (id: string, fn: (e: GradientLayer['effects'][number]) => GradientLayer['effects'][number], key?: string) => store.updateLayer(layerId, l => ({ ...l, effects: l.effects.map(e => e.id === id ? fn(e) : e) }), { coalesce: key });
  const setPointFx = (id: string, fn: (e: NonNullable<MeshPoint['effects']>[number]) => NonNullable<MeshPoint['effects']>[number], key?: string) => {
    if (!sel) return;
    setPt(sel.id, { effects: (sel.effects ?? []).map(effect => effect.id === id ? fn(effect) : effect) }, key);
  };
  const pointTransform = { ...IDENTITY, ...(sel?.transform ?? {}) };

  return <div data-testid="mesh-panel">
    <Section title="Colour points" hint={`${pts.length} points`}>
      <p className="hint">Drag points on the canvas. Drag the square handle to resize. Double-tap empty canvas to add a point.</p>
      <div className="gs-chips" role="listbox" aria-label="Mesh points">
        {pts.map((p, i) => <button key={p.id} type="button" role="option" aria-selected={p.id === selId} className={`gs-stopchip ${p.id === selId ? 'sel' : ''}`} onClick={() => store.selectStop(p.id)} data-testid="mesh-chip"><i style={{ background: p.color, opacity: Math.max(0.25, p.alpha) }} />{i + 1}</button>)}
      </div>
      {sel ? <div className="gs-stopprops" data-testid="mesh-point">
        <ColorInput color={sel.color} alpha={sel.alpha} onChange={(c, a) => setPt(sel.id, { color: c, alpha: a }, `mc-${sel.id}`)} label="Point colour" testId="mesh-color" />
        <label className="nf"><span className="nf-label">Point group</span><input className="generate-select" value={sel.group ?? ''} placeholder="Ungrouped" onChange={e => setPt(sel.id, { group: e.target.value.trim() || undefined }, `mg-${sel.id}`)} data-testid="mesh-group" /></label>
        <ValueControl label="Opacity" value={Math.round(sel.alpha * 100)} min={0} max={100} unit="%" def={100} onChange={v => setPt(sel.id, { alpha: v / 100 }, `ma-${sel.id}`)} testId="mesh-alpha" {...sliderGesture} />
        <ValueControl label="Position X" value={sel.x} min={-20} max={120} step={0.5} unit="%" onChange={v => setPt(sel.id, { x: v }, `mx-${sel.id}`)} testId="mesh-x" {...sliderGesture} />
        <ValueControl label="Position Y" value={sel.y} min={-20} max={120} step={0.5} unit="%" onChange={v => setPt(sel.id, { y: v }, `my-${sel.id}`)} testId="mesh-y" {...sliderGesture} />
        <ValueControl label="Size" value={sel.size} min={4} max={160} step={0.5} unit="%" def={48} onChange={v => setPt(sel.id, { size: v }, `ms-${sel.id}`)} testId="mesh-size" {...sliderGesture} />
        <ValueControl label="Point falloff" value={sel.core ?? layer.mesh.core} min={0} max={100} unit="%" def={layer.mesh.core} onChange={v => setPt(sel.id, { core: v }, `mf-${sel.id}`)} testId="mesh-point-falloff" {...sliderGesture} />
        <div className="gs-btnrow"><button type="button" className="btn" onClick={() => setPt(sel.id, { locked: !sel.locked })} aria-pressed={!!sel.locked} data-testid="mesh-lock">{sel.locked ? <Unlock /> : <Lock />}{sel.locked ? 'Unlock point' : 'Lock point'}</button><button type="button" className="btn" onClick={dup}><Copy />Duplicate</button><button type="button" className="btn danger" onClick={remove} data-testid="mesh-delete"><Trash2 />Delete</button></div>
        <Section title="Point transform" hint="Adjust this point without changing the rest of the mesh">
          {(['x', 'y', 'scale', 'rotate', 'skewX', 'skewY'] as const).map(key => {
            const position = key === 'x' || key === 'y';
            const scale = key === 'scale';
            const label = key === 'x' ? 'Offset X' : key === 'y' ? 'Offset Y' : key === 'rotate' ? 'Rotate' : key === 'skewX' ? 'Skew X' : key === 'skewY' ? 'Skew Y' : 'Scale';
            const value = pointTransform[key] * (scale ? 100 : 1);
            return <ValueControl key={key} label={label} value={value} min={position ? -100 : scale ? 10 : -180} max={position ? 100 : scale ? 500 : 180} step={0.5} unit={position ? '%' : scale ? '%' : '°'} def={scale ? 100 : 0} onChange={v => setPt(sel.id, { transform: { ...pointTransform, [key]: scale ? v / 100 : v } }, `mesh-ptf-${sel.id}-${key}`)} testId={`mesh-point-transform-${key}`} {...sliderGesture} />;
          })}
          <button type="button" className="btn wide" onClick={() => setPt(sel.id, { transform: { ...IDENTITY } })} data-testid="mesh-point-transform-reset"><RotateCcw />Reset point transform</button>
        </Section>
        <Section title="Point effects" hint={`${(sel.effects ?? []).filter(effect => effect.enabled).length} active`}>
          <div className="gs-chips gs-addchips" role="group" aria-label="Add point effect">
            {EFFECT_LIST.map(effect => <button key={effect.id} type="button" className="chip" title={effect.hint} onClick={() => setPt(sel.id, { effects: [...(sel.effects ?? []), newEffect(effect.id, { seed })] })} data-testid={`mesh-point-add-fx-${effect.id}`}>+ {effect.label}</button>)}
          </div>
          {(sel.effects ?? []).map(effect => {
            const def = EFFECTS[effect.type];
            if (!def) return null;
            return <div key={effect.id} className={`gs-fxcard ${effect.enabled ? '' : 'off'}`} data-testid="mesh-point-fx-card">
              <div className="gs-fxhead"><b>{def.label}</b><Switch label="" checked={effect.enabled} onChange={enabled => setPointFx(effect.id, current => ({ ...current, enabled }))} testId={`mesh-point-fx-on-${effect.type}`} /><button type="button" className="icon-btn" aria-label={`Remove point ${def.label}`} onClick={() => setPt(sel.id, { effects: (sel.effects ?? []).filter(current => current.id !== effect.id) })}><Trash2 /></button></div>
              {def.params.map(param => <ValueControl key={param.key} label={param.label} value={effect.params[param.key] ?? param.def} min={param.min} max={param.max} step={param.step} unit={param.unit} def={param.def} onChange={value => setPointFx(effect.id, current => ({ ...current, params: { ...current.params, [param.key]: value } }), `mesh-point-fx-${effect.id}-${param.key}`)} testId={`mesh-point-fx-${effect.type}-${param.key}`} {...sliderGesture} />)}
            </div>;
          })}
        </Section>
      </div> : <p className="gs-empty">Select a point to edit its colour, position and size.</p>}
      <button type="button" className="btn wide" onClick={add} data-testid="mesh-add"><Plus />Add point</button>
      <input ref={imageInput} type="file" accept="image/*" hidden data-testid="mesh-image-input" onChange={e => { void importImage(e.currentTarget.files?.[0]); }} />
      <button type="button" className="btn wide" onClick={() => imageInput.current?.click()} data-testid="mesh-image-import"><ImageUp />Extract points from image</button>
    </Section>
    <Section title="Blend">
      <ValueControl label="Core (hold colour)" value={layer.mesh.core} min={0} max={100} unit="%" def={40} onChange={v => setMesh(m => ({ ...m, core: v }), 'core')} testId="mesh-core" {...sliderGesture} />
      <div className="field-label">Base colour</div>
      <ColorInput color={layer.mesh.base || '#000000'} alpha={1} showAlpha={false} onChange={c => setMesh(m => ({ ...m, base: c }), 'mbase')} label="Mesh base" testId="mesh-base" />
      <button type="button" className="btn wide" onClick={() => setMesh(m => ({ ...m, base: '' }))}>No base (transparent)</button>
      <div className="field-label">Colour interpolation</div>
      <Seg value={layer.space} label="Colour space" options={[{ id: 'srgb', label: 'sRGB' }, { id: 'srgb-linear', label: 'Linear RGB' }, { id: 'oklab', label: 'OKLab' }, { id: 'oklch', label: 'OKLCH' }]} onChange={v => store.updateLayer(layerId, { space: v })} />
    </Section>
    <Section title="Color harmony" hint="suggestions from selected point">
      <Seg value={harmony} label="Color harmony" options={harmonyOptions} onChange={setHarmony} testId="mesh-harmony" />
      <div className="gs-palettes"><div className="gs-pal"><span>{suggested.map((color, i) => <i key={`${color}-${i}`} style={{ background: color }} />)}</span>{harmony}</div></div>
      <button type="button" className="btn wide" onClick={applyHarmony} data-testid="mesh-apply-harmony">Apply harmony {sel?.group ? `to ${sel.group}` : 'to points'}</button>
    </Section>
    <Section title="Generator settings">
      <div className="gs-palettes">{PALETTES.map(([n, c]) => <button key={n} type="button" className="gs-pal" onClick={() => palette(c)} data-testid={`mesh-pal-${n.toLowerCase()}`}><span>{c.map(x => <i key={x} style={{ background: x }} />)}</span>{n}</button>)}</div>
      <div className="field-label">Layout</div>
      <Seg value={pattern} label="Layout pattern" options={MESH_PATTERNS.map(p => ({ id: p.id, label: p.label }))} onChange={p => { setPattern(p); relayout(p, seed); }} testId="mesh-pattern" />
      <ValueControl label="Points" value={pts.length} min={2} max={12} def={4} onChange={v => regenerate(v)} testId="mesh-count" {...sliderGesture} />
      <ValueControl label="Seed" value={seed} min={1} max={999} def={7} onChange={v => relayout(pattern, v)} testId="mesh-seed" {...sliderGesture} />
      <button type="button" className="btn wide" onClick={randomize} data-testid="mesh-randomize"><Shuffle />Regenerate from seed</button>
    </Section>
    <Section title="Mesh effects" hint={`${layer.effects.length} active`}>
      <p className="hint">Add texture, lighting, color mixing, and distortion. Seeded effects repeat the same result.</p>
      <div className="gs-chips gs-addchips" role="group" aria-label="Add mesh effect">
        {EFFECT_LIST.map(effect => <button key={effect.id} type="button" className="chip" title={effect.hint} onClick={() => store.updateLayer(layerId, l => ({ ...l, effects: [...l.effects, newEffect(effect.id, { seed })] }))} data-testid={`mesh-add-fx-${effect.id}`}>+ {effect.label}</button>)}
      </div>
      {layer.effects.map(effect => {
        const def = EFFECTS[effect.type];
        if (!def) return null;
        return <div key={effect.id} className={`gs-fxcard ${effect.enabled ? '' : 'off'}`} data-testid="mesh-fx-card">
          <div className="gs-fxhead"><b>{def.label}</b><Switch label="" checked={effect.enabled} onChange={v => setFx(effect.id, x => ({ ...x, enabled: v }))} testId={`mesh-fx-on-${effect.type}`} /><button type="button" className="icon-btn" aria-label={`Remove ${def.label}`} onClick={() => store.updateLayer(layerId, l => ({ ...l, effects: l.effects.filter(x => x.id !== effect.id) }))}><Trash2 /></button></div>
          {def.params.map(param => <ValueControl key={param.key} label={param.label} value={effect.params[param.key] ?? param.def} min={param.min} max={param.max} step={param.step} unit={param.unit} def={param.def} onChange={v => setFx(effect.id, x => ({ ...x, params: { ...x.params, [param.key]: v } }), `mesh-fx-${effect.id}-${param.key}`)} testId={`mesh-fx-${effect.type}-${param.key}`} {...sliderGesture} />)}
        </div>;
      })}
    </Section>
  </div>;
}
