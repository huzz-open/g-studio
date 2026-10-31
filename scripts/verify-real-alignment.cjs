// Run against a manifest of existing, hash-verified input images and generated GLBs.
// No inference, synthetic model, optimizer changes or writes to source assets.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), crypto = require('node:crypto')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { createBuiltinParts } = require('../src/shared/parts/builtins.ts')
const { decodeMesh, meshDataUri } = require('../src/shared/parts/mesh.ts')
const { meshExtents, buildPartModel, alignPartModel, imageBounds } = require('../src/modules/scene-lighting/part-model.ts')
const { findOrientation } = require('../src/modules/scene-lighting/orientation-fit.ts')
const { ORIENTATION_METHOD } = require('../src/shared/parts/orientation-reference.ts')
const { RIGHT, UP, FORWARD, PITCH, YAW } = require('../src/modules/scene-lighting/model.ts')
const manifest = path.resolve(process.argv[2] || 'output/alignment-real-20261029/inputs.json'), folder = path.dirname(manifest)
const inputs = JSON.parse(fs.readFileSync(manifest, 'utf8')), report = { camera: { RIGHT, UP, FORWARD, PITCH, YAW }, method: ORIENTATION_METHOD, runs: [] }
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const positions = mesh => { const array = new Float32Array(mesh.vertices.length / 3); for (let i = 0, j = 0; i < mesh.vertices.length; i += 9, j += 3) array.set(mesh.vertices.subarray(i, i + 3), j); return array }
for (const input of inputs) {
  const bytes = fs.readFileSync(input.mesh), source = fs.readFileSync(input.source)
  if (sha(bytes) !== input.meshSha256 || sha(source) !== input.inputSha256) throw Error('Source hash mismatch')
  const uri = meshDataUri(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), decoded = decodeMesh(uri)
  // Reproduce legacy application to the matching built-in sprite: only its image,
  // normal settings and image anchor are inherited; model is exclusively GLB.
  const part = createBuiltinParts().find(p => p.id === `example:${input.id}`)
  if (!part) throw Error('This manifest requires an existing matching project sprite')
  part.version = 2; part.image = { uri: 'data:image/png;base64,' + source.toString('base64'), width: input.width, height: input.height }
  part.model = { kind: 'mesh', size: meshExtents(decoded).size, mesh: { uri, sha256: input.meshSha256, inputSha256: input.inputSha256, providerId: input.provider, warnings: [] } }
  const pixels = { width: input.width, height: input.height, data: new Uint8ClampedArray(fs.readFileSync(input.rgba)) }
  const before = buildPartModel(part, pixels), bounds = imageBounds(part)
  const stages = { before }
  alignPartModel(part, pixels); stages.sizeOnly = buildPartModel(part, pixels)
  const started = performance.now()
  let last = -1
  const result = findOrientation(positions(before), pixels, [0, 0, 0], p => { const step = Math.floor(p / 25); if (step !== last) { last = step; console.log(`${input.id}: ${p}%`) } })
  const elapsedMs = performance.now() - started
  part.model.imageFit.rotation = result.rotation; part.model.imageFit.projection = result.projection
  stages.after = buildPartModel(part, pixels)
  for (const [name, mesh] of Object.entries(stages)) fs.writeFileSync(path.join(folder, `${input.id}-${name}.f32`), Buffer.from(positions(mesh).buffer))
  const run = { ...input, bounds, triangleCount: before.triangles.length, result, elapsedMs, fit: part.model.imageFit, sourceModel: 'shadow.glb; no template model used' }
  report.runs.push(run); fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ id: input.id, elapsedMs, optimizerIoU: result.score, initialOptimizerIoU: result.initialScore }))
}
