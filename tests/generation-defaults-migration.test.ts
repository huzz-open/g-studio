import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readStoredGenerationParameters, writeStoredGenerationParameters } from '../src/shared/generation/defaults-migration.ts'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} })

test('old global and asset defaults migrate once while custom values and connection fields survive', () => {
  for (const key of ['g-studio-generation-device-v1', 'g-studio-generation-parameters-v1:sprite-01']) {
    storage.set(key, JSON.stringify({ targetFaces: 12000, seed: 88, baseUrl: 'http://localhost:8765',
      parametersByProvider: { 'hunyuan-mini': { steps: 7, resolution: 384 }, 'hunyuan-turbo': { resolution: 256 },
        'hunyuan-2-1': { resolution: 512 }, custom: { resolution: 384 } } }))
    const migrated = readStoredGenerationParameters(key)
    assert.equal(migrated.targetFaces, 40000)
    assert.equal(migrated.seed, 88)
    assert.equal(migrated.baseUrl, 'http://localhost:8765')
    assert.deepEqual(migrated.parametersByProvider['hunyuan-mini'], { steps: 7 })
    assert.deepEqual(migrated.parametersByProvider['hunyuan-turbo'], {})
    assert.equal(migrated.parametersByProvider['hunyuan-2-1'].resolution, 512)
    assert.equal(migrated.parametersByProvider.custom.resolution, 384)
    migrated.targetFaces = 12000
    migrated.parametersByProvider['hunyuan-mini'].resolution = 384
    writeStoredGenerationParameters(key, migrated)
    assert.deepEqual(readStoredGenerationParameters(key), migrated)
  }
})

test('model regeneration preserves historical parameters; fresh explicit choices never migrate', () => {
  const old = { targetFaces: 12000, seed: 12345, parametersByProvider: { 'hunyuan-mini': { resolution: 384 } } }
  storage.set('model-history', JSON.stringify(old))
  assert.deepEqual(readStoredGenerationParameters('model-history', false), old)
  writeStoredGenerationParameters('fresh-choice', old)
  assert.deepEqual(readStoredGenerationParameters('fresh-choice'), old)
  storage.set('custom-budget', JSON.stringify({ ...old, targetFaces: 24000 }))
  assert.equal(readStoredGenerationParameters('custom-budget').targetFaces, 24000)
})
