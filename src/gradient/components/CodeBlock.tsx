import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { useStudio } from './ui';

/** Light syntax colouring: comments, selectors, property names, functions. Pure text → spans (no HTML injection). */
function highlight(line: string, lang: string) {
  if (lang === 'json' || lang === 'svg' || lang === 'html') {
    const parts = line.split(/(<\/?[\w-]+|\/?>|"[^"]*"|\/\*.*?\*\/)/g);
    return parts.map((p, i) => <span key={i} className={p.startsWith('<') ? 'tk-tag' : p.startsWith('"') ? 'tk-str' : p.startsWith('/*') ? 'tk-com' : undefined}>{p}</span>);
  }
  if (/^\s*\/\*/.test(line)) return <span className="tk-com">{line}</span>;
  const prop = line.match(/^(\s*)([a-z-]+|--[\w-]+)(:)(.*)$/);
  if (prop) return <>{prop[1]}<span className="tk-prop">{prop[2]}</span>{prop[3]}{fn(prop[4])}</>;
  if (/\{\s*$/.test(line) || /^\s*[.#\[@:]/.test(line)) return <span className="tk-sel">{line}</span>;
  return fn(line);
}
const fn = (s: string) => s.split(/([a-z-]+-gradient|var|rgba)(?=\()/g).map((p, i) => (i % 2 ? <span key={i} className="tk-fn">{p}</span> : <span key={i}>{p}</span>));

interface Props { title?: string; text: string; lang?: string; copyLabel?: string; testId?: string; actions?: ReactNode }
export default function CodeBlock({ title, text, lang = 'css', copyLabel = 'Copy', testId, actions }: Props) {
  const { announce } = useStudio();
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); announce(`${title ?? 'Code'} copied`); setTimeout(() => setDone(false), 1400); } catch { announce('Clipboard unavailable'); } };
  return <figure className="gs-code" data-testid={testId}>
    <figcaption><b>{title}</b><span className="gs-code-actions">{actions}<button type="button" className="btn small" onClick={copy} data-testid={testId ? `${testId}-copy` : undefined}>{done ? <Check /> : <Copy />}{done ? 'Copied' : copyLabel}</button></span></figcaption>
    <pre tabIndex={0}><code>{text.split('\n').map((l, i) => <div key={i} className="gs-line-code">{highlight(l, lang) || ' '}</div>)}</code></pre>
  </figure>;
}
