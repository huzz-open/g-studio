const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { tabCloseTargets } = require('../src/shared/components/editor-shell/tab-actions.ts')
const { useEditorTabs } = require('../src/shared/components/editor-shell/useEditorTabs.ts')

test('bulk closing follows displayed order and preserves pinned and non-closable tabs', () => {
  const tabs = [{id:'pin',label:'Pin',pinned:true},{id:'default',label:'Default',closable:false},
    {id:'left',label:'Left'},{id:'target',label:'Target'},{id:'right',label:'Right',dirty:true}]
  assert.deepEqual(tabCloseTargets(tabs, 'target', 'left'), ['left'])
  assert.deepEqual(tabCloseTargets(tabs, 'target', 'right'), ['right'])
  assert.deepEqual(tabCloseTargets(tabs, 'target', 'others'), ['left', 'right'])
  assert.deepEqual(tabCloseTargets(tabs, 'default', 'current'), [])
  assert.deepEqual(tabCloseTargets(tabs, 'pin', 'current'), ['pin'])
  assert.deepEqual(tabCloseTargets(tabs, 'missing', 'others'), [])
  assert.deepEqual(tabCloseTargets(tabs, 'right', 'right'), [])
})

test('pinning reorders the actual tabs without changing the active document or duplicating tabs', () => {
  const manager = useEditorTabs({prefix:'test',factory:id=>({id}),autoEmptyTab:false})
  const a = manager.createTab(), b = manager.createTab(), c = manager.createTab()
  manager.switchTab(b.id)
  manager.setPinned(c.id, true); manager.setPinned(a.id, true)
  assert.deepEqual(manager.instances.value.map(t=>t.id), [a.id,c.id,b.id])
  assert.equal(manager.activeTabId.value, b.id)
  manager.setPinned(a.id, false)
  assert.deepEqual(manager.instances.value.map(t=>t.id), [c.id,a.id,b.id])
  manager.setPinned(c.id, true)
  assert.equal(manager.instances.value.length, 3)
  manager.closeTab(c.id)
  assert.equal(manager.pinnedIds.value.has(c.id), false)
  assert.equal(manager.activeTabId.value, b.id)
})

test('saved-file tabs restore pin state and order even when restored IDs change', async () => {
  const storage = new Map()
  global.sessionStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}
  const options = {prefix:'persist',factory:id=>({id,gsPath:id+'.gs'}),persist:{key:'test-tabs',
    serialize:tab=>({gsPath:tab.gsPath}),restore:async d=>({id:'restored:'+d.gsPath,gsPath:d.gsPath}),getIdentifier:tab=>tab.gsPath}}
  const first = useEditorTabs(options); await first.ready
  const a = first.createTab(), b = first.createTab()
  first.switchTab(a.id); first.setPinned(b.id, true)
  const second = useEditorTabs(options); await second.ready
  assert.deepEqual(second.instances.value.map(t=>t.gsPath), [b.gsPath,a.gsPath])
  assert.equal(second.pinnedIds.value.has('restored:'+b.gsPath), true)
  assert.equal(second.activeInstance.value.gsPath, a.gsPath)
  delete global.sessionStorage
})
