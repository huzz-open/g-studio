const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { createRequire } = require('node:module'), { nextTick } = require('vue')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { createScene, DEFAULT_SCENE_ID } = require('../src/modules/scene-lighting/model.ts')
const KEY = 'g-studio-scene-tabs-v3'

function loadStore(storage = new Map()) {
  const filename = path.resolve(__dirname, '../src/modules/scene-lighting/store.ts'), requireFromStore = createRequire(filename)
  const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.hot', 'undefined')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const localRequire = name => {
    if (name === '../../shared/parts/library') return { loadPartLibrary: async () => {}, partLibrary: {} }
    if (name === '../../shared/i18n') return { translate: key => key === 'parts.defaultScene' ? '默认场景' : key }
    return requireFromStore(name)
  }
  vm.runInThisContext(`(function(require,module,exports,localStorage){${compiled}\n})`, { filename })(localRequire, module, module.exports, {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  })
  return { store: module.exports, storage }
}

test('fresh session has one protected corner scene using the spread layout', async () => {
  const { store } = loadStore()
  await store.initializeScene()
  const tabs = store.useSceneTabs(), doc = tabs.activeInstance.value
  assert.equal(tabs.instances.value.length, 1)
  assert.equal(doc.id, DEFAULT_SCENE_ID)
  assert.equal(doc.name, '默认场景')
  assert.equal(doc.state.scene, 'corner')
  assert.deepEqual(doc.state.items, createScene('spread').items)
  store.closeSceneTab(doc.id)
  assert.equal(tabs.instances.value.length, 1)
  assert.equal(store.closedScenes.value.length, 0)
  const extra = await store.newSceneTab()
  assert.equal(extra.state.scene, 'corner')
  store.closeSceneTab(extra.id)
  assert.equal(tabs.activeInstance.value.id, DEFAULT_SCENE_ID)
  store.reopenSceneTab()
  assert.equal(tabs.activeInstance.value.id, extra.id)
})

test('existing sessions gain one default scene without overwriting saved scenes', async () => {
  const state = createScene('mutual'), storage = new Map([[KEY, JSON.stringify({version:3, number:1, tabs:[{id:'saved',name:'My scene',state}], closed:[], activeId:'saved'})]])
  const { store } = loadStore(storage)
  await store.initializeScene(); await store.initializeScene()
  const tabs = store.useSceneTabs()
  assert.equal(tabs.instances.value.filter(d => d.id === DEFAULT_SCENE_ID).length, 1)
  assert.deepEqual(tabs.instances.value.find(d => d.id === 'saved').state, state)
  assert.equal(tabs.activeInstance.value.id, DEFAULT_SCENE_ID)
})

test('default scene edits persist across reload without regenerating the layout', async () => {
  const { store, storage } = loadStore()
  await store.initializeScene()
  store.useSceneTabs().activeInstance.value.state.items[0].x = 1.25
  await nextTick()
  const reload = loadStore(storage).store
  await reload.initializeScene()
  assert.equal(reload.useSceneTabs().instances.value.length, 1)
  assert.equal(reload.useSceneTabs().activeInstance.value.state.items[0].x, 1.25)
})

test('scene pins survive reload and reopening while the default scene remains protected', async () => {
  const { store, storage } = loadStore()
  await store.initializeScene()
  const extra = await store.newSceneTab('Pinned scene'), manager = store.useSceneTabs()
  manager.setPinned(extra.id, true)
  await nextTick()
  const reload = loadStore(storage).store; await reload.initializeScene()
  assert.equal(reload.useSceneTabs().instances.value[0].id, extra.id)
  assert.equal(reload.useSceneTabs().pinnedIds.value.has(extra.id), true)
  reload.closeSceneTab(extra.id); reload.reopenSceneTab()
  assert.equal(reload.useSceneTabs().instances.value[0].id, extra.id)
  assert.equal(reload.useSceneTabs().pinnedIds.value.has(extra.id), true)
  reload.closeSceneTab(DEFAULT_SCENE_ID)
  assert.ok(reload.useSceneTabs().instances.value.some(doc=>doc.id===DEFAULT_SCENE_ID))
})
