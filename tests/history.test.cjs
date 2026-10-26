const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {reactive}=require('vue')
const {createHistoryStack}=require('../src/shared/history/createHistoryStack.ts')
const {createObservedHistory}=require('../src/shared/history/createObservedHistory.ts')
const {historyShortcut}=require('../src/shared/history/interaction.ts')
function setup(observe=false){const state=reactive({x:0,z:0}),factory=observe?createObservedHistory:createHistoryStack;return {state,history:factory({capture:()=>({...state}),restore:s=>Object.assign(state,s),maxSize:3})}}
test('undo/redo branch, capacity and no-op batches',()=>{
  const {state,history:h}=setup();h.batch(()=>{});assert.equal(h.canUndo.value,false)
  for(let i=1;i<=4;i++)h.batch(()=>state.x=i)
  h.undo();assert.equal(state.x,3);h.redo();assert.equal(state.x,4)
  h.undo();h.batch(()=>state.x=10);assert.equal(h.canRedo.value,false)
  h.undo();h.undo();h.undo();h.undo();assert.equal(state.x,1)
})
test('a continuous gesture records one undo step, with redo restoring its final state',()=>{
  const {state,history:h}=setup(true);h.begin();state.x=1;state.x=2;state.z=5;h.end()
  h.undo();assert.deepEqual({...state},{x:0,z:0});assert.equal(h.canUndo.value,false)
  h.redo();assert.deepEqual({...state},{x:2,z:5});h.dispose()
})
test('observed batch is one step and restoring does not record recursive history',()=>{
  const {state,history:h}=setup(true);h.batch(()=>{state.x=3;state.z=4})
  h.undo();assert.deepEqual({...state},{x:0,z:0});assert.equal(h.canUndo.value,false)
  h.redo();assert.deepEqual({...state},{x:3,z:4});assert.equal(h.canRedo.value,false);h.dispose()
})
test('interrupted transactions cannot commit late or erase a new owner',()=>{
  const {state,history:h}=setup();const first=h.transaction();state.x=1
  const second=h.transaction();state.x=2;first.commit();second.commit()
  h.undo();assert.equal(state.x,1);h.undo();assert.equal(state.x,0)
  const third=h.transaction();state.x=7;h.undo();third.commit();assert.equal(state.x,0)
  h.redo();assert.equal(state.x,7)
})
test('cancel restores a drag, clear invalidates old transaction handles',()=>{
  const {state,history:h}=setup(true);h.begin();state.x=2;h.cancel();assert.equal(state.x,0);assert.equal(h.canUndo.value,false)
  const tx=h.transaction();state.z=9;h.clear();tx.commit();assert.equal(h.canUndo.value,false);h.dispose()
})
test('restoration errors release the restoring guard',()=>{
  const h=createHistoryStack({capture:()=>1,restore:()=>{throw new Error('failed')}})
  h.record();assert.throws(()=>h.undo());assert.equal(h.isRestoring.value,false)
})
test('documents keep separate stacks and disposal stops automatic recording',()=>{
  const a=setup(true),b=setup(true);a.state.x=2;b.state.x=8;a.history.undo();assert.equal(b.state.x,8)
  a.history.dispose();a.state.x=4;assert.equal(a.history.canUndo.value,false);b.history.dispose()
})
test('shortcut mapping handles uppercase shifted keys and Command on macOS',()=>{
  const key=(key,options={})=>historyShortcut({key,ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,...options})
  assert.equal(key('z'),'undo');assert.equal(key('Z',{shiftKey:true}),'redo');assert.equal(key('y'),'redo')
  assert.equal(key('z',{ctrlKey:false,metaKey:true}),'undo');assert.equal(key('z',{altKey:true}),null)
})
