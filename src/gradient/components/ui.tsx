import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pipette } from 'lucide-react';
import { hexToRgb, parseColor, rgbToHex } from '../engine/color';
import { projectSvg } from '../engine/svg';
import type { StudioStore } from '../engine/store';
import { DirectionAwareRange } from '../../shared/controls';

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

/* Small shared building blocks for Gradient Studio panels. */

export interface StudioCtxValue { store: StudioStore; announce: (m: string) => void }
export const StudioCtx = createContext<StudioCtxValue>(null as unknown as StudioCtxValue);
export const useStudio = () => useContext(StudioCtx);

const CHECKER = 'repeating-conic-gradient(#3a414a 0% 25%, #2a3037 0% 50%) 50% / 12px 12px';

function hexToHsv(hex: string) {
  const { r, g, b } = hexToRgb(hex), red = r / 255, green = g / 255, blue = b / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let h = 0;
  if (delta) {
    h = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? delta / max * 100 : 0, v: max * 100 };
}

function hsvToHex(h: number, saturation: number, brightness: number) {
  const hue = ((h % 360) + 360) % 360, s = saturation / 100, v = brightness / 100;
  const chroma = v * s, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), m = v - chroma;
  const rgb = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbToHex({ r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 });
}

/** Advanced touch-friendly hue / saturation / brightness picker, hex entry, and optional alpha. */
export function ColorInput({ color, alpha, onChange, onCommit, showAlpha = true, label, testId }: {
  color: string; alpha: number; onChange: (c: string, a: number) => void; onCommit?: () => void; showAlpha?: boolean; label?: string; testId?: string;
}) {
  const { store, announce } = useStudio();
  const pickerColor = parseColor(color)?.hex ?? '#000000';
  const [open, setOpen] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(pickerColor));
  const [hexDraft, setHexDraft] = useState(pickerColor);
  const [draft, setDraft] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const close = () => { setOpen(false); onCommit?.(); };
  const publish = (next: typeof hsv, nextAlpha = alpha) => {
    setHsv(next);
    const nextColor = hsvToHex(next.h, next.s, next.v);
    setHexDraft(nextColor);
    onChange(nextColor, nextAlpha);
  };
  const placePicker = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth - 16), height = Math.min(showAlpha ? 400 : 340, window.innerHeight - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 8;
    setPosition({ left, top: below + height <= window.innerHeight ? below : Math.max(8, rect.top - height - 8) });
  };
  const toggle = () => {
    if (open) { close(); return; }
    const initial = hexToHsv(pickerColor);
    setHsv(initial);
    setHexDraft(pickerColor);
    placePicker();
    setOpen(true);
  };
  const setFromPointer = (clientX: number, clientY: number) => {
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    publish({
      ...hsv,
      s: Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)),
      v: Math.max(0, Math.min(100, 100 - (clientY - rect.top) / rect.height * 100)),
    });
  };
  const commitHex = () => {
    const parsed = parseColor(hexDraft);
    if (parsed) {
      setHsv(hexToHsv(parsed.hex));
      setHexDraft(parsed.hex);
      onChange(parsed.hex, /^#?[0-9a-f]{8}$|rgba|transparent/i.test(hexDraft) ? parsed.alpha : alpha);
      onCommit?.();
    } else setHexDraft(pickerColor);
  };
  const commitOuterHex = () => {
    if (draft === null) return;
    const parsed = parseColor(draft);
    setDraft(null);
    if (parsed) {
      onChange(parsed.hex, /^#?[0-9a-f]{8}$|rgba|transparent/i.test(draft) ? parsed.alpha : alpha);
      onCommit?.();
    }
  };
  const buildSampleCanvas = async () => {
    const project = store.getState().project;
    const markup = projectSvg(project, { size: `width="${project.canvas.w}" height="${project.canvas.h}"` });
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The scene preview could not be rendered for color sampling'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = project.canvas.w;
      canvas.height = project.canvas.h;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas color sampling is not available in this browser');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      sampleCanvasRef.current = canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const beginNativeSampling = async () => {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      const sampled = parseColor(result.sRGBHex);
      if (!sampled) throw new Error('The screen color picker returned an invalid color');
      setHsv(hexToHsv(sampled.hex));
      setHexDraft(sampled.hex);
      onChange(sampled.hex, alpha);
      onCommit?.();
      setOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      announce(error instanceof Error ? error.message : 'Could not pick a screen color');
    }
  };
  const sampleCanvasPoint = (clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY);
    const art = target instanceof Element ? target.closest<HTMLElement>('.gs-art-root') : null;
    const canvas = sampleCanvasRef.current;
    if (!art || !canvas) return false;
    const rect = art.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((clientX - rect.left) / rect.width * canvas.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((clientY - rect.top) / rect.height * canvas.height)));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
    const sampled = rgbToHex({ r, g, b });
    setHsv(hexToHsv(sampled));
    setHexDraft(sampled);
    onChange(sampled, showAlpha ? a / 255 : alpha);
    return true;
  };
  const samplePointRef = useRef(sampleCanvasPoint);
  samplePointRef.current = sampleCanvasPoint;
  const samplingActionsRef = useRef({ onCommit, announce });
  samplingActionsRef.current = { onCommit, announce };

  useLayoutEffect(() => {
    if (!open) return;
    placePicker();
    const reposition = () => placePicker();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !pickerRef.current?.contains(target)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keydown);
    };
  }, [open, onCommit]);
  useEffect(() => {
    if (!sampling) return;
    let pointerId: number | null = null;
    let didSample = false;
    const stop = (event: PointerEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const down = (event: PointerEvent) => {
      if (pointerId !== null) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const art = target instanceof Element ? target.closest('.gs-art-root') : null;
      if (!art) return;
      pointerId = event.pointerId;
      stop(event);
      const stage = art.closest<HTMLElement>('.gs-stage');
      try { stage?.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
      didSample = samplePointRef.current(event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stop(event);
      didSample = samplePointRef.current(event.clientX, event.clientY) || didSample;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stop(event);
      didSample = samplePointRef.current(event.clientX, event.clientY) || didSample;
      pointerId = null;
      setSampling(false);
      if (didSample) { samplingActionsRef.current.onCommit?.(); samplingActionsRef.current.announce('Preview color sampled'); }
      else samplingActionsRef.current.announce('Could not sample that point from the preview');
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stop(event);
      pointerId = null;
      setSampling(false);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
    };
  }, [sampling]);
  const beginPreviewSampling = async () => {
    try {
      await buildSampleCanvas();
      setSampling(true);
      announce('Touch and drag across the gradient preview to sample a color');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not prepare preview color sampling');
    }
  };

  const picker = open ? createPortal(<div ref={pickerRef} className="gs-color-popover" style={{ left: position.left, top: position.top }} role="dialog" aria-label={`${label ?? 'Colour'} picker`} data-testid={testId ? `${testId}-picker` : undefined}>
    <div className="gs-picker-head"><b>{label ?? 'Colour'}</b><button type="button" onClick={close} aria-label="Close colour picker">×</button></div>
    <div className="gs-picker-actions">
      {window.EyeDropper && <button type="button" className="gs-picker-drop" onClick={beginNativeSampling} data-testid={testId ? `${testId}-screen-dropper` : undefined}><Pipette />Pick anywhere on screen</button>}
      <button type="button" className={`gs-picker-drop ${sampling ? 'active' : ''}`} onClick={() => sampling ? setSampling(false) : void beginPreviewSampling()} data-testid={testId ? `${testId}-preview-dropper` : undefined}><Pipette />{sampling ? 'Cancel preview sampling' : 'Pick from preview'}</button>
    </div>
    {sampling && <p className="gs-picker-hint" role="status">Touch the preview, then drag to sample; release to keep the color.</p>}
    <div ref={planeRef} className="gs-color-plane" style={{ backgroundColor: hsvToHex(hsv.h, 100, 100) }} role="slider" aria-label={`${label ?? 'Colour'} saturation and brightness`} aria-valuetext={`${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`} aria-valuemin={0} aria-valuemax={100} tabIndex={0}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setFromPointer(event.clientX, event.clientY); }}
      onPointerMove={event => { if (event.buttons) setFromPointer(event.clientX, event.clientY); }}
      onPointerUp={() => onCommit?.()}
      onKeyDown={event => {
        const step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          publish({
            ...hsv,
            s: Math.max(0, Math.min(100, hsv.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))),
            v: Math.max(0, Math.min(100, hsv.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))),
          });
        }
      }}>
      <i className="gs-color-plane-marker" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
    </div>
    <label className="gs-picker-label" htmlFor={testId ? `${testId}-hue` : undefined}>Hue <span>{Math.round(hsv.h)}°</span></label>
    <DirectionAwareRange id={testId ? `${testId}-hue` : undefined} className="gs-hue-slider" min={0} max={359} value={Math.round(hsv.h)} aria-label={`${label ?? 'Colour'} hue`}
      onValueChange={value => publish({ ...hsv, h: Number(value) })} onPointerUp={() => onCommit?.()} onTouchIntentEnd={() => onCommit?.()} data-testid={testId ? `${testId}-hue` : undefined} />
    <div className="gs-picker-row">
      <label className="gs-hex-label">HEX
        <input className="gs-hex" aria-label={`${label ?? 'Colour'} hex`} value={hexDraft} spellCheck={false}
          onChange={event => setHexDraft(event.target.value)} onBlur={commitHex} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} data-testid={testId ? `${testId}-picker-hex` : undefined} />
      </label>
      <span className="gs-picker-preview" style={{ background: pickerColor }} aria-label={`Current colour ${pickerColor}`} />
    </div>
    {showAlpha && <>
      <label className="gs-picker-label" htmlFor={testId ? `${testId}-alpha` : undefined}>Opacity <span>{Math.round(alpha * 100)}%</span></label>
      <DirectionAwareRange id={testId ? `${testId}-alpha` : undefined} className="gs-alpha-slider" min={0} max={100} value={Math.round(alpha * 100)} aria-label={`${label ?? 'Colour'} opacity`}
        onValueChange={value => onChange(pickerColor, Number(value) / 100)} onPointerUp={() => onCommit?.()} onTouchIntentEnd={() => onCommit?.()} data-testid={testId ? `${testId}-alpha` : undefined} />
    </>}
  </div>, document.body) : null;

  return <>
    <div className="gs-color">
      <button ref={triggerRef} type="button" className="gs-swatch" style={{ background: CHECKER }} onClick={toggle} aria-label={`Open ${label ?? 'colour'} picker`} aria-haspopup="dialog" aria-expanded={open} data-testid={testId}>
        <span style={{ background: color, opacity: Math.max(0.12, alpha) }} />
      </button>
      <input className="gs-hex" aria-label={`${label ?? 'Colour'} hex`} value={draft ?? color} spellCheck={false}
        onChange={event => setDraft(event.target.value)} onBlur={commitOuterHex} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} data-testid={testId ? `${testId}-hex` : undefined} />
      {showAlpha && <span className="gs-alpha-tag">{Math.round(alpha * 100)}%</span>}
    </div>
    {picker}
  </>;
}

/** Circular angle dial. Drag anywhere on it; snaps to 15° near multiples. */
export function Dial({ value, onChange, onCommit, size = 76, label = 'Angle' }: { value: number; onChange: (a: number) => void; onCommit?: () => void; size?: number; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    let a = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const snap = Math.round(a / 15) * 15; if (e.shiftKey || Math.abs(snap - a) < 3) a = snap % 360;
    onChange(Math.round(a * 10) / 10);
  };
  return <div ref={ref} className="gs-dial" style={{ width: size, height: size }} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(value)} tabIndex={0}
    onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e); }}
    onPointerMove={e => { if (e.buttons) move(e); }} onPointerUp={() => onCommit?.()}
    onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { onChange((value + 1) % 360); } if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { onChange((value + 359) % 360); } }} onKeyUp={() => onCommit?.()}>
    {[0, 90, 180, 270].map(t => <i key={t} className="gs-dial-tick" style={{ transform: `rotate(${t}deg)` }} />)}
    <i className="gs-dial-needle" style={{ transform: `rotate(${value}deg)` }}><b /></i>
    <span>{Math.round(value)}°</span>
  </div>;
}

export function Empty({ children }: { children: ReactNode }) { return <p className="gs-empty">{children}</p>; }
export { CHECKER };
