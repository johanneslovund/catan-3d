import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const files = [
  'public/models/Stone tower.glb',
  'public/models/Castle.glb',
];

await MeshoptDecoder.ready;

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

for (const f of files) {
  console.log(`Decompressing: ${f}`);
  const doc = await io.read(f);
  // Strip meshopt so the output is plain uncompressed GLB that Blender can read
  doc.getRoot().listExtensionsUsed().forEach(ext => ext.dispose());
  await io.write(f.replace('.glb', '_uncompressed.glb'), doc);
  console.log(`  → ${f.replace('.glb', '_uncompressed.glb')}`);
}
console.log('Done.');
