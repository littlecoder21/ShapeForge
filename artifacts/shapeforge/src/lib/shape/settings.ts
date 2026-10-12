/** Editor settings — visual size, touch size and geometry are three independent things. */
export type EditorSettings = {
  nodeSize: number;      // visual node diameter, screen px
  handleSize: number;    // visual handle diameter, screen px
  touchSize: number;     // invisible touch target diameter, screen px
  showTouch: boolean;    // draw the touch area of the selected node/handle
  snapOn: boolean;       // master switch
  snapGrid: boolean; gridSize: number;
  snapH: boolean; snapV: boolean;
  snapAngle: boolean; angleStep: number;
  snapNode: boolean; snapCenter: boolean;
  assist: boolean;       // magnetic horizontal / vertical / 45° / 15° detection while moving
  guides: boolean;       // show smart guides
  snapPx: number;        // magnet distance in screen px
  penMode: 'corner' | 'smooth';
  lockRatio: boolean; fromCenter: boolean;
};

export const DEFAULT_SETTINGS: EditorSettings = {
  nodeSize: 10, handleSize: 9, touchSize: 44, showTouch: false,
  snapOn: true, snapGrid: false, gridSize: 25, snapH: false, snapV: false,
  snapAngle: false, angleStep: 15, snapNode: true, snapCenter: true, assist: true, guides: true, snapPx: 8,
  penMode: 'corner', lockRatio: true, fromCenter: false,
};

const KEY = 'shapeforge.editor.v1';
export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_SETTINGS };
}
export function saveSettings(s: EditorSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
