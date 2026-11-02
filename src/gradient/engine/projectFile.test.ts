import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, normalizeProject } from './model';
import { parseProjectFile, serializeProjectFile } from './projectFile';

test('versioned project files round-trip the editable project', () => {
  const project = newProject({ name: 'Portable design' });
  const imported = parseProjectFile(serializeProjectFile(project));
  assert.deepEqual(imported.project, normalizeProject(project));
  assert.deepEqual(imported.warnings, []);
});

test('legacy raw project JSON remains importable', () => {
  const project = newProject({ name: 'Legacy design' });
  const imported = parseProjectFile(JSON.stringify(project));
  assert.deepEqual(imported.project, normalizeProject(project));
  assert.deepEqual(imported.warnings, []);
});

test('unsupported gradient and shader settings recover with warnings', () => {
  const project = newProject();
  const source = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
  const layers = source.layers as Array<Record<string, unknown>>;
  const shader = source.shader as Record<string, unknown>;
  const layerShader = layers[0].shader as Record<string, unknown>;
  layers[0].type = 'unsupported-gradient';
  layers[0].blend = 'unsupported-blend';
  layerShader.style = 'unsupported-shader';
  shader.quality = 'unsupported-quality';

  const imported = parseProjectFile(JSON.stringify(source));
  assert.equal(imported.project.layers[0].type, 'linear');
  assert.equal(imported.project.layers[0].blend, 'normal');
  assert.equal(imported.project.layers[0].shader?.style, 'flow');
  assert.equal(imported.project.shader?.quality, 'medium');
  assert.ok(imported.warnings.length >= 4);
});

test('invalid JSON is rejected before project replacement', () => {
  assert.throws(() => parseProjectFile('{'), /Invalid JSON/);
});
