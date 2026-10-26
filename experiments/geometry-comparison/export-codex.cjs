// Evaluate a frozen copy of the existing model builder, without changing it.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')

const workspace = process.argv[2] || 'C:/Users/wps/.codex/worktrees/props-lighting-review/g-studio'
const relativeFiles = [
  'src/modules/scene-lighting/model.ts',
  'src/modules/experiments/umbrella/geometry.ts',
  'src/modules/experiments/umbrella/math.ts',
]
const snapshot = path.join(__dirname, 'codex-source')
const provenance = []
for (const relative of relativeFiles) {
  const source = path.join(workspace, relative)
  const bytes = fs.readFileSync(source)
  const target = path.join(snapshot, relative)
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(target, bytes)
  provenance.push({source, snapshot: target, sha256: crypto.createHash('sha256').update(bytes).digest('hex')})
}
const allowed = new Set(relativeFiles.map(p => path.resolve(snapshot, p)))
const cache = new Map()
function load(file) {
  file = path.resolve(file)
  if (!allowed.has(file)) throw new Error(`Unexpected source dependency: ${file}`)
  if (cache.has(file)) return cache.get(file).exports
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText
  const module = {exports: {}}
  cache.set(file, module)
  new Function('module', 'exports', 'require', code)(module, module.exports, request => {
    if (!request.startsWith('.')) throw new Error(`Unexpected package: ${request}`)
    return load(path.resolve(path.dirname(file), request + '.ts'))
  })
  return module.exports
}
const {buildItem} = load(path.join(snapshot, relativeFiles[0]))
const models = {}
for (const item of ['umbrella', 'vase', 'chair']) {
  const mesh = buildItem(item)
  if (mesh.vertices.length / 27 !== mesh.triangles.length) throw new Error('Triangle count mismatch')
  models[item] = {vertexStride: 9, layout: 'position XYZ, face normal XYZ, linear RGB',
    upAxis: 'Y', vertices: Array.from(mesh.vertices), triangleCount: mesh.triangles.length}
  console.log(`${item}: ${mesh.triangles.length} original triangles`)
}
fs.writeFileSync(path.join(__dirname, 'codex-raw.json'), JSON.stringify({
  exportedAt: new Date().toISOString(), provenance,
  note: 'Existing Codex procedural models from the earlier scene-lighting work; not a new blind generation.', models,
}, null, 2))
