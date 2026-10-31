import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identifyModel, publishModel, resolveGeneratedModel, generatedModels, type ModelRecord } from '../src/shared/generation/models.ts'
import { modelKey } from '../src/shared/parts/model-options.ts'
import type { PartModel } from '../src/shared/parts/schema.ts'

const model = (hash: string): PartModel => ({kind:'mesh',size:[1,2,1],mesh:{uri:'fixture',sha256:hash,inputSha256:'input',providerId:'provider',warnings:[]}})
test('legacy embedded references follow a stable ID while authored dimensions remain unchanged',()=>{
  const old: ModelRecord={localId:'legacy-model',model:model('old')}
  const reference=structuredClone(old.model!)
  reference.size=[3,4,5]
  identifyModel(old);publishModel(old)
  assert.equal(resolveGeneratedModel(reference).mesh!.modelId,'legacy-model')
  const updated: ModelRecord={...old,modelRevision:2,model:model('new')}
  publishModel(updated)
  const resolved=resolveGeneratedModel(reference)
  assert.equal(resolved.mesh!.sha256,'new')
  assert.deepEqual(resolved.size,[3,4,5])
  assert.equal(reference.mesh!.sha256,'old','resolution must not mutate an exported snapshot')
})
test('new models stay independent even with identical output bytes; stale snapshots cannot undo replacements',()=>{
  const first: ModelRecord={localId:'first',modelId:'first',modelRevision:1,model:model('same')}
  const second: ModelRecord={localId:'second',modelId:'second',modelRevision:1,model:model('same')}
  identifyModel(first);identifyModel(second);publishModel(first);publishModel(second)
  assert.notEqual(modelKey(first.model!),modelKey(second.model!))
  publishModel({...first,modelRevision:2,model:model('changed')})
  publishModel(first)
  assert.equal(generatedModels.get('first')!.mesh!.sha256,'changed')
  assert.equal(resolveGeneratedModel(second.model!).mesh!.sha256,'same')
})
