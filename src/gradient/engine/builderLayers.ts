import { uid, type GradientLayer } from './model';
import type { StudioStore } from './store';

export type BuilderMode = 'replace' | 'add' | 'update';

/** Applies scene output while retaining enough identity to update a previously created builder group. */
export function applyBuilderLayers(store: StudioStore, source: string, generated: GradientLayer[], mode: BuilderMode): boolean {
  if (!generated.length) return false;

  const state = store.getState();
  const selected = state.project.layers.find(layer => layer.id === state.layerId);
  if (mode === 'update' && (selected?.builderSource !== source || !selected.builderGroup)) return false;
  const group = mode === 'update' ? selected!.builderGroup! : uid('bg');
  const previousGroup = mode === 'update'
    ? state.project.layers.filter(layer => layer.builderSource === source && layer.builderGroup === group)
    : [];
  const layers = generated.map((layer, index) => ({
    ...layer,
    ...(previousGroup[index] ? { id: previousGroup[index].id } : {}),
    builderSource: source,
    builderGroup: group,
  }));

  store.update(project => {
    if (mode === 'replace') return { ...project, layers };
    if (mode === 'add') return { ...project, layers: [...layers, ...project.layers] };

    const firstIndex = project.layers.findIndex(layer => layer.builderSource === source && layer.builderGroup === group);
    if (firstIndex < 0) return project;
    const remaining = project.layers.filter(layer => layer.builderSource !== source || layer.builderGroup !== group);
    remaining.splice(Math.min(firstIndex, remaining.length), 0, ...layers);
    return { ...project, layers: remaining };
  });

  const first = layers.find(layer => layer.type !== 'noise') ?? layers[0];
  store.select(mode === 'update' && layers.some(layer => layer.id === selected!.id) ? selected!.id : first.id);
  return true;
}
