/* Rasterises the live artwork DOM (the exact CSS composition the preview shows) at any point in time.
 *
 *   1. the artwork element is cloned once; its WebGL / shader canvases become <img> placeholders, UI chips are dropped
 *   2. the clone plus the stylesheet rules it needs are wrapped in an SVG <foreignObject>
 *   3. CSS animations are *sought*, not played: every animated element gets a paused animation with a negative delay, so the
 *      browser draws exactly the state at time t (the same maths as the preview, frame accurate and repeatable)
 *   4. the SVG is decoded as an image and drawn onto the output canvas at any resolution (vector scaling, so text and
 *      gradients stay crisp)
 */

export type FitMode = 'contain' | 'cover' | 'stretch';
export interface RasterGeometry { width: number; height: number; fit: FitMode }

export interface DomRasterizerOptions {
  /** the live `.gs-art-root` element (attached to the document and laid out) */
  root: HTMLElement;
  /** layout size of the artwork in CSS pixels (the project canvas) */
  width: number;
  height: number;
  /** undefined = keep the artwork background, '' = transparent, otherwise a CSS colour */
  background?: string;
}

interface AnimatedTarget { index: number; pseudo: '' | '::before' | '::after'; delays: number[] }

const EMPTY_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const RELEVANT_SELECTOR = /gs-art-root|gs-shader-canvas|gs-layer-shader|gs-webgl-ready|g-layer|g-text|mesh-point|gs-capture/;

const toMs = (token: string): number => {
  const value = parseFloat(token);
  if (!Number.isFinite(value)) return 0;
  return /ms\s*$/.test(token) ? value : value * 1000;
};
const splitList = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean);

/** The stylesheet rules that style the artwork (layer rules from the studio sheet, @property registrations). */
function collectGlobalCss(): string {
  const out: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const text = rule.cssText;
      if (text.startsWith('@property')) { out.push(text); continue; }
      if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
        if (RELEVANT_SELECTOR.test(rule.selectorText)) out.push(text);
        continue;
      }
      if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
        try { if (window.matchMedia(rule.conditionText || rule.media.mediaText).matches) walk(rule.cssRules); } catch { /* skip */ }
        continue;
      }
      const grouping = rule as CSSGroupingRule;
      if (grouping.cssRules && /^@(layer|supports)/.test(text)) walk(grouping.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules); } catch { /* cross-origin stylesheet */ }
  }
  return out.join('\n');
}

export class DomRasterizer {
  readonly width: number;
  readonly height: number;
  private readonly wrapper: HTMLElement;
  private readonly template: HTMLElement;
  private readonly animationStyle: HTMLStyleElement;
  private readonly placeholders: { image: HTMLImageElement; canvas: HTMLCanvasElement }[] = [];
  private readonly animated: AnimatedTarget[] = [];

  constructor(options: DomRasterizerOptions) {
    const { root } = options;
    this.width = Math.max(1, Math.round(options.width));
    this.height = Math.max(1, Math.round(options.height));
    const liveElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    this.template = root.cloneNode(true) as HTMLElement;
    const cloneElements = [this.template, ...Array.from(this.template.querySelectorAll<HTMLElement>('*'))];

    // find animated elements (and pseudo-elements) on the live tree
    liveElements.forEach((element, index) => {
      for (const pseudo of ['', '::before', '::after'] as const) {
        const style = getComputedStyle(element, pseudo || null);
        const names = splitList(style.animationName);
        if (!names.length || names.every(name => name === 'none')) continue;
        const delays = splitList(style.animationDelay).map(toMs);
        this.animated.push({ index, pseudo, delays: names.map((_, i) => delays.length ? delays[i % delays.length] : 0) });
        cloneElements[index]?.setAttribute('data-sfc', String(index));
      }
    });

    // shader canvases become images (a canvas cannot travel through SVG); UI notes are not part of the artwork
    liveElements.forEach((element, index) => {
      const clone = cloneElements[index];
      if (!clone) return;
      if (element instanceof HTMLCanvasElement) {
        const image = document.createElement('img');
        image.className = clone.className;
        const inline = clone.getAttribute('style');
        if (inline) image.setAttribute('style', inline);
        image.setAttribute('alt', '');
        image.setAttribute('src', EMPTY_PIXEL);
        clone.replaceWith(image);
        this.placeholders.push({ image, canvas: element });
      } else if (element.classList.contains('gs-shader-status')) {
        clone.remove();
      }
    });
    if (options.background !== undefined) this.template.style.backgroundColor = options.background || 'transparent';

    this.animationStyle = document.createElement('style');
    const baseline = document.createElement('style');
    baseline.textContent = `${getComputedStyle(root).boxSizing === 'border-box' ? '*,*::before,*::after{box-sizing:border-box}\n' : ''}${collectGlobalCss()}`;
    this.wrapper = document.createElement('div');
    this.wrapper.setAttribute('style', `position:relative;width:${this.width}px;height:${this.height}px;overflow:hidden`);
    this.wrapper.append(baseline, this.animationStyle, this.template);
  }

  get animatedCount() { return this.animated.length; }
  get canvasCount() { return this.placeholders.length; }

  /** The SVG document for the scene at `timeMs` (milliseconds since the animations started). */
  markup(timeMs: number, geometry: RasterGeometry): string {
    this.animationStyle.textContent = this.animated.map(target =>
      `[data-sfc="${target.index}"]${target.pseudo}{animation-delay:${target.delays.map(delay => `${(delay - timeMs).toFixed(3)}ms`).join(',')} !important;animation-play-state:paused !important}`).join('\n');
    for (const { image, canvas } of this.placeholders) {
      let source = EMPTY_PIXEL;
      if (canvas.width > 0 && canvas.height > 0) { try { source = canvas.toDataURL('image/png'); } catch { /* tainted or lost */ } }
      image.setAttribute('src', source);
    }
    const par = geometry.fit === 'stretch' ? 'none' : geometry.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
    const body = new XMLSerializer().serializeToString(this.wrapper);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${this.width} ${this.height}" preserveAspectRatio="${par}"><foreignObject x="0" y="0" width="${this.width}" height="${this.height}">${body}</foreignObject></svg>`;
  }

  /** Draws the scene at `timeMs` onto `ctx` (the caller clears / fills the canvas first). */
  async render(ctx: CanvasRenderingContext2D, geometry: RasterGeometry, timeMs: number): Promise<void> {
    const svg = this.markup(timeMs, geometry);
    // a data: URL, not a blob: URL — browsers taint the canvas for blob-URL SVG images that contain HTML
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch (error) {
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror');
      throw new Error(parsed ? `The layers could not be serialised (${parsed.textContent?.split('\n')[0] ?? 'invalid markup'})` : `The layers could not be rasterised${error instanceof Error ? `: ${error.message}` : ''}`);
    }
    ctx.drawImage(image, 0, 0, geometry.width, geometry.height);
  }
}
