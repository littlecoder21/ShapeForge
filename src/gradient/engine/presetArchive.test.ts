import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newTextLayer } from './model';
import { createPresetArchive, extractProjectJsonFromZip } from './presetArchive';
import { parseProjectFile } from './projectFile';

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflatedJsonZip(name: string, json: string): Promise<Blob> {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const content = encoder.encode(json);
  const compression = new CompressionStream('deflate-raw' as CompressionFormat);
  const compressedStream = new Blob([new Uint8Array(content).buffer]).stream().pipeThrough(compression);
  const compressedBuffer = await new Response(compressedStream).arrayBuffer();
  const compressed = new Uint8Array(compressedBuffer);
  const crc = crc32(content);
  const local = new Uint8Array(30 + nameBytes.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0x0800, true);
  localView.setUint16(8, 8, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, compressed.length, true);
  localView.setUint32(22, content.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0x0800, true);
  centralView.setUint16(10, 8, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, compressed.length, true);
  centralView.setUint32(24, content.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);

  const directoryOffset = local.length + compressed.length;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, directoryOffset, true);
  return new Blob([local, compressed, central, end], { type: 'application/zip' });
}

test('preset ZIP contains a matching folder with editable JSON and preview PNG', async () => {
  const text = newTextLayer();
  text.text!.content = 'Saved title';
  const project = newProject({ layers: [text] });
  const previewBytes = Uint8Array.of(137, 80, 78, 71);
  const archive = await createPresetArchive('My Preset', project, new Blob([previewBytes], { type: 'image/png' }));
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer);

  assert.equal(archive.type, 'application/zip');
  let offset = 0;
  const files = new Map<string, Uint8Array>();
  while (view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataLength = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    files.set(name, bytes.slice(dataStart, dataStart + dataLength));
    offset = dataStart + dataLength;
  }

  assert.deepEqual([...files.keys()], ['My Preset/My Preset.json', 'My Preset/My Preset.png']);
  const json = JSON.parse(new TextDecoder().decode(files.get('My Preset/My Preset.json')));
  assert.equal(json.project.layers[0].text.content, 'Saved title');
  assert.deepEqual(files.get('My Preset/My Preset.png'), previewBytes);
  assert.equal(view.getUint32(offset, true), 0x02014b50);

  const extracted = await extractProjectJsonFromZip(archive);
  const imported = parseProjectFile(extracted);
  assert.equal(imported.project.layers[0].text?.content, 'Saved title');
});

test('ZIP import supports deflated project JSON', async () => {
  const project = newProject({ name: 'Compressed preset' });
  const archive = await deflatedJsonZip('Compressed preset/project.json', JSON.stringify(project));
  const imported = parseProjectFile(await extractProjectJsonFromZip(archive));
  assert.equal(imported.project.name, 'Compressed preset');
});

test('ZIP import rejects archives without project JSON', async () => {
  const archive = await createPresetArchive('Preview only', newProject(), new Blob(['image']));
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const centralOffset = view.getUint32(bytes.length - 22 + 16, true);
  const centralNameStart = centralOffset + 46;
  const oldNameLength = view.getUint16(centralOffset + 28, true);
  const name = new TextEncoder().encode('Preview only/Preview only.jpeg');
  assert.equal(name.length, oldNameLength);
  bytes.set(name, centralNameStart);
  const alteredArchive = new Blob([bytes], { type: 'application/zip' });
  await assert.rejects(extractProjectJsonFromZip(alteredArchive), /does not contain a project JSON file/);
});
