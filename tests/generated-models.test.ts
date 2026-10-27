import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identifyModel, publishModel, resolveModelGeometry, generatedModels, type ModelRecord } from '../src/shared/generation/models.ts'
import { geometryKey } from '../src/shared/parts/geometry-options.ts'
import type { PartGeometry } from '../src/shared/parts/schema.ts'

const geometry = (hash: string): PartGeometry => ({kind:'mesh',size:[1,2,1],mesh:{uri:'fixture',sha256:hash,inputSha256:'input',providerId:'provider',warnings:[]}})
test('legacy embedded references follow a stable ID while authored dimensions remain unchanged',()=>{
  const old: ModelRecord={localId:'legacy-model',geometry:geometry('old')}
  const reference=structuredClone(old.geometry!)
  reference.size=[3,4,5]
  identifyModel(old);publishModel(old)
  assert.equal(resolveModelGeometry(reference).mesh!.modelId,'legacy-model')
  const updated: ModelRecord={...old,modelRevision:2,geometry:geometry('new')}
  publishModel(updated)
  const resolved=resolveModelGeometry(reference)
  assert.equal(resolved.mesh!.sha256,'new')
  assert.deepEqual(resolved.size,[3,4,5])
  assert.equal(reference.mesh!.sha256,'old','resolution must not mutate an exported snapshot')
})
test('new models stay independent even with identical output bytes; stale snapshots cannot undo replacements',()=>{
  const first: ModelRecord={localId:'first',modelId:'first',modelRevision:1,geometry:geometry('same')}
  const second: ModelRecord={localId:'second',modelId:'second',modelRevision:1,geometry:geometry('same')}
  identifyModel(first);identifyModel(second);publishModel(first);publishModel(second)
  assert.notEqual(geometryKey(first.geometry!),geometryKey(second.geometry!))
  publishModel({...first,modelRevision:2,geometry:geometry('changed')})
  publishModel(first)
  assert.equal(generatedModels.get('first')!.mesh!.sha256,'changed')
  assert.equal(resolveModelGeometry(second.geometry!).mesh!.sha256,'same')
})
