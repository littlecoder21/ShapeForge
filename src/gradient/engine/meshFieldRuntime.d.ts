import type { PreparedMeshField, MeshFieldInput } from './meshField';
import type { MeshFieldSettings } from './meshFieldSettings';
export function prepareMeshField(input: MeshFieldInput, settings: Partial<MeshFieldSettings> | undefined, aspect: number, time?: number): PreparedMeshField;
export function sampleMeshField(field: PreparedMeshField, u: number, v: number, out: ArrayLike<number> & { [i: number]: number }): void;
export function renderPreparedMeshField(field: PreparedMeshField, width: number, height: number, options?: { finish?: boolean }): Uint8ClampedArray;
export function mountMeshFields(root?: ParentNode): void;
