import { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Shuffle } from 'lucide-react';
import { Seg, Switch } from '../../../shared/controls';
import { DEFAULT_INTERACTIVE_SETTINGS, type InteractiveSettings } from '../../interactive/types';
import {
  RIG_EFFECTS, RIG_EFFECT_GROUPS, RIG_MAX_RULES, describeRig, instantiateRig, makeDrive, makeRule, newRuleId, normalizeRig, type InteractionRig, type RigEffectDef, type RigRule,
} from '../../interactive/rig/model';
import { ALL_RIG_PRESETS, ALL_RIG_PRESET_GROUPS, ALL_RIG_PRESET_MAP } from '../../interactive/rig/presetCatalog';
import { useStudio } from '../ui';
import { Num, Section, Select } from './parts';
import RuleCard from './RuleCard';
import { useShader } from './context';

interface SavedRig { id: string; name: string; rig: InteractionRig }
const SAVED_KEY = 'shapeforge.interaction-rigs.v1';
const FALLOFF_OPTIONS = [{ id: 'soft', label: 'Soft' }, { id: 'linear', label: 'Linear' }, { id: 'sharp', label: 'Sharp' }, { id: 'gaussian', label: 'Gaussian' }] as const;
const pickOne = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/** A random but sensible interaction: one movement effect, one colour / light effect and a drive that makes it feel alive. */
function surprise(): InteractionRig {
  const moves = RIG_EFFECTS.filter(effect => effect.stage === 'warp' && effect.group !== 'Glitch & time');
  const looks = RIG_EFFECTS.filter(effect => effect.stage !== 'warp');
  const first = makeRule(pickOne(moves).id, { source: pickOne(['pointer', 'pointer', 'trail', 'symmetry'] as const) });
  if (Math.random() < 0.7) first.drives.push(makeDrive({ source: pickOne(['press', 'speed', 'hold', 'lfoSine'] as const), target: 'amount', mode: pickOne(['boost', 'swing', 'scale'] as const), depth: 0.8 + Math.random() * 0.6, rate: 0.3 + Math.random() }));
  const second = makeRule(pickOne(looks).id, { colorMode: pickOne(['palette', 'spectrum', 'scene'] as const) });
  const rules = [first, second];
  if (Math.random() < 0.4) rules.push(makeRule('glow', { source: 'clicks', amount: 1 }));
  return { name: 'Surprise', presetId: '', gain: 1, physics: { mode: Math.random() < 0.3 ? 'spring' : 'smooth', stiffness: 170, damping: 0.4 + Math.random() * 0.3, pressAttack: 0.06, pressRelease: 0.35, holdTime: 1.2, trailLife: 0.9 }, rules };
}

export default function InteractPanel() {
  const { announce } = useStudio();
  const { settings, update, updateRig, targets, patchLayers, primary } = useShader();
  const rig = settings.rig;
  const [group, setGroup] = useState<string>(ALL_RIG_PRESET_MAP[rig.presetId]?.group ?? ALL_RIG_PRESET_GROUPS[0]);
  const [saved, setSaved] = useState<SavedRig[]>([]);
  const [saveName, setSaveName] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [openRule, setOpenRule] = useState<string | null>(rig.rules[0]?.id ?? null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) setSaved(parsed.map(item => {
        const value = item as { id?: unknown; name?: unknown; rig?: unknown };
        const next = normalizeRig(value.rig);
        return next && typeof value.id === 'string' && typeof value.name === 'string' ? { id: value.id, name: value.name, rig: next } : null;
      }).filter((item): item is SavedRig => !!item));
    } catch { /* ignore a corrupt list */ }
  }, []);

  const presets = useMemo(() => ALL_RIG_PRESETS.filter(item => item.group === group), [group]);
  const activePreset = ALL_RIG_PRESET_MAP[rig.presetId];
  const setRules = (rules: RigRule[], coalesce?: string) => updateRig(current => ({ ...current, presetId: '', name: current.presetId ? `${ALL_RIG_PRESET_MAP[current.presetId]?.label ?? 'Custom'} (edited)` : current.name, rules }), coalesce);
  const changeRule = (index: number, next: RigRule, coalesce?: string) => setRules(rig.rules.map((rule, i) => i === index ? next : rule), coalesce ? `rule-${coalesce}` : undefined);
  const moveRule = (index: number, direction: -1 | 1) => {
    const rules = [...rig.rules];
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    [rules[index], rules[target]] = [rules[target], rules[index]];
    setRules(rules);
  };
  const addEffect = (effect: RigEffectDef) => {
    if (rig.rules.length >= RIG_MAX_RULES) { announce(`An interaction can hold up to ${RIG_MAX_RULES} rules.`); return; }
    const rule = makeRule(effect.id);
    setRules([...rig.rules, rule]);
    setOpenRule(rule.id);
  };
  const choosePreset = (id: string) => {
    const preset = ALL_RIG_PRESET_MAP[id];
    if (!preset) return;
    const next = preset.build();
    // The always-on base response (gradient warp + colour displacement) shows the same bulge around the pointer whatever the
    // preset is, which made every style look alike. A chosen style now starts as itself; the base sliders stay available below.
    update({ rig: next, interactionEnabled: true, interactionDistortion: 0, interactionDisplacement: 0 });
    setOpenRule(next.rules[0]?.id ?? null);
  };
  const persist = (list: SavedRig[], message?: string) => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); setSaved(list); if (message) announce(message); }
    catch (error) { announce(error instanceof Error ? `Could not save: ${error.message}` : 'Could not save the interaction.'); }
  };
  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) return;
    persist([...saved.filter(item => item.name.toLocaleLowerCase() !== name.toLocaleLowerCase()), { id: `rig-${Date.now().toString(36)}`, name, rig: { ...rig, name, presetId: '' } }], `Saved interaction “${name}”`);
    setSaveName('');
  };
  const copyJson = async () => {
    const text = JSON.stringify(rig, null, 2);
    setJsonText(text);
    setShowJson(true);
    try { await navigator.clipboard.writeText(text); announce('Interaction copied as JSON.'); } catch { /* the text area still shows it */ }
  };
  const importJson = () => {
    try {
      const next = normalizeRig(JSON.parse(jsonText));
      if (!next) throw new Error('That JSON is not an interaction.');
      update({ rig: instantiateRig(next) });
      announce(`Imported “${next.name}”.`);
    } catch (error) { announce(error instanceof Error ? error.message : 'Could not import that JSON.'); }
  };
  const colors = settings.interactionColors;

  return <div data-testid="shader-panel-interaction">
    <Section title="Pointer & touch" aside={settings.interactionEnabled ? 'On' : 'Off'} testId="shader-pointer-menu">
      <Switch label="Enable pointer and touch" checked={settings.interactionEnabled} onChange={interactionEnabled => update({ interactionEnabled })} testId="shader-interaction" />
      <Switch label="Touch interaction" checked={settings.touchEnabled} onChange={touchEnabled => update({ touchEnabled })} testId="shader-touch" />
      {targets.length > 0 && <>
        <Switch label={`Selected layers react (${targets.length})`} checked={primary?.shader?.interact !== false} onChange={interact => patchLayers({ interact })} />
        <Num label="Layer reaction strength" value={primary?.shader?.reaction ?? 1} min={-1.5} max={2} def={1} unit="×" onChange={reaction => patchLayers({ reaction }, undefined, 'reaction')} />
      </>}
    </Section>

    <Section title="Interaction style" aside={describeRig(rig)}>
      <div className="gs-chip-row" role="tablist" aria-label="Interaction groups">
        {ALL_RIG_PRESET_GROUPS.map(item => <button key={item} type="button" role="tab" aria-selected={group === item} className={`chip ${group === item ? 'active' : ''}`} onClick={() => setGroup(item)}>{item}</button>)}
      </div>
      <div className="gs-preset-grid" data-testid="shader-rig-presets">
        {presets.map(preset => <button key={preset.id} type="button" className={`gs-preset-card ${rig.presetId === preset.id ? 'active' : ''}`} onClick={() => choosePreset(preset.id)} title={preset.description} aria-pressed={rig.presetId === preset.id} data-testid={`shader-rig-preset-${preset.id}`}>
          <b>{preset.label}</b>
        </button>)}
      </div>
      <p className="hint" data-testid="shader-pointer-mode-description">{activePreset ? activePreset.description : `${rig.name}: a custom stack of ${rig.rules.length} rule${rig.rules.length === 1 ? '' : 's'}.`}</p>
      <div className="gs-chip-row">
        <button type="button" className="btn small" onClick={() => update({ rig: surprise() })} data-testid="shader-rig-surprise"><Shuffle />Surprise me</button>
        <button type="button" className="btn small" onClick={copyJson}><Copy />Copy JSON</button>
        <button type="button" className="btn small" onClick={() => setShowJson(!showJson)}>{showJson ? 'Hide JSON' : 'Paste JSON'}</button>
      </div>
      {showJson && <>
        <textarea className="gs-json" value={jsonText} onChange={event => setJsonText(event.target.value)} rows={6} spellCheck={false} aria-label="Interaction JSON" placeholder="Paste an interaction exported from ShapeForge" />
        <button type="button" className="btn small" onClick={importJson} disabled={!jsonText.trim()}>Import</button>
      </>}
      <label className="field-label" htmlFor="shader-rig-name">Save this interaction</label>
      <div className="gs-interactive-custom-row">
        <input id="shader-rig-name" className="gs-custom-preset-name" value={saveName} onChange={event => setSaveName(event.target.value)} placeholder="Name" maxLength={48} />
        <button type="button" className="btn small" onClick={saveCurrent} disabled={!saveName.trim()}>Save</button>
      </div>
      {saved.map(item => <div className="gs-interactive-saved" key={item.id}>
        <button type="button" className="chip" onClick={() => update({ rig: instantiateRig(item.rig) })}>{item.name}</button>
        <button type="button" className="link" onClick={() => persist(saved.filter(entry => entry.id !== item.id))} aria-label={`Delete ${item.name}`}>Remove</button>
      </div>)}
    </Section>

    <Section title="Builder" aside={`${rig.rules.length} / ${RIG_MAX_RULES}`} testId="shader-rig-builder">
      <p className="hint">Each rule is an effect, where it comes from, its shape and what drives it. Rules run top to bottom, so order matters. Open a rule to change anything; nothing needs code.</p>
      {rig.rules.length === 0 && <p className="hint">No rules yet: the shader will not react. Add an effect below or pick an interaction style.</p>}
      {rig.rules.map((rule, index) => <RuleCard
        key={rule.id}
        rule={rule}
        index={index}
        total={rig.rules.length}
        initiallyOpen={rule.id === openRule}
        onChange={(next, coalesce) => changeRule(index, next, coalesce)}
        onRemove={() => setRules(rig.rules.filter((_, i) => i !== index))}
        onDuplicate={() => { if (rig.rules.length < RIG_MAX_RULES) setRules([...rig.rules.slice(0, index + 1), { ...JSON.parse(JSON.stringify(rule)) as RigRule, id: newRuleId() }, ...rig.rules.slice(index + 1)]); }}
        onMove={direction => moveRule(index, direction)}
      />)}
      <details className="gs-add-effect" data-testid="shader-rig-add">
        <summary className="btn wide"><Plus />Add effect</summary>
        {RIG_EFFECT_GROUPS.map(item => <div key={item} className="gs-add-group">
          <h4>{item}</h4>
          <div className="gs-chip-row">{RIG_EFFECTS.filter(effect => effect.group === item).map(effect => <button key={effect.id} type="button" className="chip" title={effect.blurb} onClick={() => addEffect(effect)} data-testid={`shader-rig-add-${effect.id}`}>{effect.icon} {effect.label}</button>)}</div>
        </div>)}
      </details>
    </Section>

    <Section title="Pointer feel" open={false}>
      <Num label="Master gain" value={rig.gain} min={0} max={3} def={1} onChange={gain => updateRig(current => ({ ...current, gain }), 'gain')} testId="shader-rig-gain" />
      <Num label="Influence radius" value={settings.interactionRadius} min={0.04} max={0.8} def={DEFAULT_INTERACTIVE_SETTINGS.interactionRadius} unit="×" onChange={interactionRadius => update({ interactionRadius }, 'radius')} testId="shader-radius" />
      <Seg value={rig.physics.mode} options={[{ id: 'smooth', label: 'Smooth follow' }, { id: 'spring', label: 'Spring' }]} onChange={mode => updateRig(current => ({ ...current, physics: { ...current.physics, mode } }))} label="Pointer physics" testId="shader-rig-physics" />
      {rig.physics.mode === 'smooth'
        ? <Num label="Response delay" value={settings.interactionDelay} min={0} max={600} step={5} unit="ms" def={DEFAULT_INTERACTIVE_SETTINGS.interactionDelay} onChange={interactionDelay => update({ interactionDelay }, 'delay')} testId="shader-interaction-delay" />
        : <>
          <Num label="Spring stiffness" value={rig.physics.stiffness} min={20} max={900} step={5} def={170} onChange={stiffness => updateRig(current => ({ ...current, physics: { ...current.physics, stiffness } }), 'stiff')} />
          <Num label="Spring damping" value={rig.physics.damping} min={0.05} max={2} def={0.55} onChange={damping => updateRig(current => ({ ...current, physics: { ...current.physics, damping } }), 'damp')} />
          <p className="hint">Low damping overshoots and wobbles like jelly; around 1 settles without bounce.</p>
        </>}
      <Num label="Press attack" value={rig.physics.pressAttack} min={0.01} max={1.5} def={0.06} unit="s" onChange={pressAttack => updateRig(current => ({ ...current, physics: { ...current.physics, pressAttack } }), 'attack')} />
      <Num label="Press release" value={rig.physics.pressRelease} min={0.01} max={3} def={0.35} unit="s" onChange={pressRelease => updateRig(current => ({ ...current, physics: { ...current.physics, pressRelease } }), 'release')} />
      <Num label="Hold charge time" value={rig.physics.holdTime} min={0.1} max={6} def={1.2} unit="s" onChange={holdTime => updateRig(current => ({ ...current, physics: { ...current.physics, holdTime } }), 'hold')} />
      <Num label="Motion trail length" value={rig.physics.trailLife} min={0.1} max={3} def={0.9} unit="s" onChange={trailLife => updateRig(current => ({ ...current, physics: { ...current.physics, trailLife } }), 'trail')} />
    </Section>

    <Section title="Base response" open={false}>
      <p className="hint">Always-on reactions underneath the builder: gradient warp, colour displacement and glitch. Choosing an interaction style switches the warp and displacement off so the style shows as itself; raise them here to blend the base reaction back in.</p>
      <Num label="Interaction strength" value={settings.interactionStrength} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.interactionStrength} onChange={interactionStrength => update({ interactionStrength }, 'interaction')} testId="shader-interaction-strength" />
      <Num label="Gradient distortion" value={settings.interactionDistortion} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.interactionDistortion} onChange={interactionDistortion => update({ interactionDistortion }, 'distortion')} testId="shader-interaction-distortion" />
      <Select id="shader-displacement-mode" label="Colour displacement direction" value={settings.interactionDisplacementMode} options={[{ id: 'push', label: 'Push colours away' }, { id: 'pull', label: 'Pull colours toward cursor' }]} onChange={interactionDisplacementMode => update({ interactionDisplacementMode })} />
      <Num label="Cursor displacement" value={settings.interactionDisplacement} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.interactionDisplacement} onChange={interactionDisplacement => update({ interactionDisplacement }, 'displacement')} testId="shader-displacement" />
      <Num label="Velocity reaction" value={settings.interactionVelocityReaction} min={0} max={2} def={DEFAULT_INTERACTIVE_SETTINGS.interactionVelocityReaction} onChange={interactionVelocityReaction => update({ interactionVelocityReaction }, 'velocity-reaction')} testId="shader-velocity-reaction" />
      <Num label="Interaction glitch" value={settings.interactionGlitch} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.interactionGlitch} onChange={interactionGlitch => update({ interactionGlitch }, 'interaction-glitch')} testId="shader-interaction-glitch" />
      <Select id="shader-interaction-falloff" label="Influence falloff" value={settings.interactionFalloff} options={[...FALLOFF_OPTIONS]} onChange={interactionFalloff => update({ interactionFalloff } as Partial<InteractiveSettings>)} />
      <Num label="Pointer light (overlay lift)" value={settings.glow} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.glow} onChange={glow => update({ glow }, 'glow')} testId="shader-glow" />
      <Switch label="Click ripples" checked={settings.ripplesEnabled} onChange={ripplesEnabled => update({ ripplesEnabled })} testId="shader-ripples" />
      {settings.ripplesEnabled && <>
        <Num label="Ripple strength" value={settings.rippleStrength} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.rippleStrength} onChange={rippleStrength => update({ rippleStrength }, 'ripple-strength')} testId="shader-ripple-strength" />
        <Num label="Ripple speed" value={settings.rippleSpeed} min={0.05} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.rippleSpeed} onChange={rippleSpeed => update({ rippleSpeed }, 'ripple-speed')} testId="shader-ripple-speed" />
        <Num label="Maximum ripples" value={settings.maximumRipples} min={1} max={8} step={1} def={DEFAULT_INTERACTIVE_SETTINGS.maximumRipples} onChange={maximumRipples => update({ maximumRipples }, 'max-ripples')} testId="shader-ripple-count" />
      </>}
    </Section>

    <Section title="Interaction colours" open={false}>
      <Select id="shader-interaction-color-source" label="Interaction colours" value={settings.interactionColorSource} options={[{ id: 'layer', label: 'Auto · use this layer’s colours' }, { id: 'custom', label: 'Custom multicolour palette' }]} onChange={interactionColorSource => update({ interactionColorSource })} />
      {settings.interactionColorSource === 'custom' && <div className="gs-interaction-palette">
        {colors.map((color, index) => <div className="gs-interaction-palette-row" key={`interaction-color-${index}`}>
          <label className="field-label" htmlFor={`shader-interaction-color-${index}`}>Colour {index + 1}</label>
          <input id={`shader-interaction-color-${index}`} className="gs-interaction-color" type="color" value={color} onChange={event => { const next = [...colors]; next[index] = event.target.value; update({ interactionColors: next, interactionColor: next[0] }); }} data-testid={`shader-interaction-color-${index}`} />
          {colors.length > 1 && <button type="button" className="link" onClick={() => { const next = colors.filter((_, i) => i !== index); update({ interactionColors: next, interactionColor: next[0] }); }} aria-label={`Remove interaction colour ${index + 1}`}>Remove</button>}
        </div>)}
        <button type="button" className="btn small" disabled={colors.length >= 5} onClick={() => { const next = [...colors, '#fbbf24']; update({ interactionColors: next, interactionColor: next[0] }); }} data-testid="shader-add-interaction-color">Add colour</button>
      </div>}
      <Num label="Palette blend" value={settings.interactionColorMix} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.interactionColorMix} onChange={interactionColorMix => update({ interactionColorMix }, 'color-mix')} testId="shader-interaction-color-mix" />
      <Num label="Colour animation" value={settings.interactionColorSpeed} min={0} max={2} def={DEFAULT_INTERACTIVE_SETTINGS.interactionColorSpeed} unit="×" onChange={interactionColorSpeed => update({ interactionColorSpeed }, 'color-speed')} testId="shader-interaction-color-speed" />
    </Section>
  </div>;
}
