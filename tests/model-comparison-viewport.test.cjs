const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { createRenderer, defineComponent, h, nextTick } = require('vue')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f)

function fixture(options = {}) {
  const { descriptor } = parse(fs.readFileSync('src/shared/parts/ModelComparisonViewport.vue', 'utf8'))
  const script = compileScript(descriptor, { id: 'comparison-test', inlineTemplate: true })
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const sides = []
  const viewport = defineComponent({ emits: ['ready'], setup(_, { emit }) { sides.push(() => emit('ready')); return () => h('canvas') } })
  const file = require.resolve('../src/shared/parts/ModelComparisonViewport.vue')
  const localRequire = require('node:module').createRequire(file), mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if ((name.endsWith('LightingViewport.vue')||name.endsWith('ModelImageViewport.vue'))) return { __esModule: true, default: viewport }
    if (name.endsWith('CanvasControls.vue')) return { __esModule: true, default: defineComponent({setup:()=>()=>h('div')}) }
    if (name === '../i18n') return { useI18n: () => ({ t: key => key }) }
    return localRequire(name)
  }, mod, mod.exports)
  const node = type => ({ type, props: {}, children: [], captures: new Set(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }), setPointerCapture(id) { this.captures.add(id) }, hasPointerCapture(id) { return this.captures.has(id) }, releasePointerCapture(id) { this.captures.delete(id) } })
  const renderer = createRenderer({
    createElement: node, createText: () => node('#text'), createComment: () => node('#comment'),
    setText() {}, setElementText() {}, parentNode: n => n.parent, nextSibling: () => null,
    patchProp: (n, key, _, value) => { n.props[key] = value },
    insert(n, parent, anchor) { n.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, n) },
    remove(n) { n.parent.children.splice(n.parent.children.indexOf(n), 1) },
  })
  global.ResizeObserver = class { observe() {} disconnect() {} }
  const part = { id: 'model', image: {}, normal: {}, model: {}, imageFrame: {left:0,bottom:0,height:2} }
  const state = options.state ?? { mode: 'sprites', zoom: 5, target: [0,1,0] }
  let fits = 0, ready = 0
  const app = renderer.createApp(mod.exports.default, { original: part, candidate: part, ...options, state, autoFit: true, fitView: () => fits++, onReady: () => ready++ })
  const root = node('root'); app.mount(root)
  const host = root.children[0], divider = host.children.find(n => n.props.role === 'slider')
  return { app, host, divider, sides, state, fits: () => fits, ready: () => ready }
}

test('comparison announces readiness only after both viewport frames, then fits once', () => {
  const f = fixture()
  try {
    assert.equal(f.ready(), 0)
    f.sides[1](); assert.equal(f.ready(), 0); assert.equal(f.fits(), 0)
    f.sides[0](); assert.equal(f.ready(), 1); assert.equal(f.fits(), 1)
  } finally { f.app.unmount() }
})

test('the divider itself supports keyboard and captured pointer dragging without a handle button', async () => {
  const f = fixture()
  try {
    assert.equal(f.divider.type, 'div')
    f.divider.props.onKeydown({ key: 'ArrowRight', shiftKey: true, preventDefault() {} })
    await nextTick(); assert.equal(f.divider.props['aria-valuenow'], 60)
    const pointer = x => ({ button: 0, pointerId: 1, clientX: x, clientY: 100, preventDefault() {}, stopPropagation() {} })
    f.divider.props.onPointerdown(pointer(700)); await nextTick()
    assert.equal(f.divider.props['aria-valuenow'], 70); assert.ok(f.host.captures.has(1))
    assert.ok(f.host.props.class.includes('is-resizing'))
    f.host.props.onPointermove(pointer(1200)); await nextTick()
    assert.equal(f.divider.props['aria-valuenow'], 100)
    f.host.props.onPointercancel(pointer(1200)); await nextTick()
    assert.equal(f.host.captures.size, 0); assert.ok(!f.host.props.class.includes('is-resizing'))
  } finally { f.app.unmount() }
})


test('fixed model comparison keeps a centered noninteractive divider while orbiting either side', async () => {
  global.HTMLCanvasElement = class {}
  const state = {mode:'model', inspectionYaw:20, inspectionPitch:10, zoom:5, target:[0,1,0]}
  const f = fixture({fixedDivider:true, state})
  try {
    assert.equal(f.divider, undefined)
    const line = f.host.children.find(n => n.props.class?.includes('fixed-line'))
    assert.equal(line.props.style.left, '50%')
    assert.equal(line.props.onPointerdown, undefined)
    const pointer = (x,y) => ({target:new HTMLCanvasElement(),button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){},stopPropagation(){}})
    for (const x of [200,700]) {
      const before=state.inspectionYaw
      f.host.props.onPointerdownCapture(pointer(x,100))
      f.host.props.onPointermove(pointer(x+100,120))
      f.host.props.onPointerup(pointer(x+100,120))
      assert.equal(state.inspectionYaw,before-35)
    }
    await nextTick()
    assert.equal(line.props.style.left,'50%')
    assert.equal(f.host.captures.size,0)
  } finally { f.app.unmount(); delete global.HTMLCanvasElement }
})

test('single model renders one viewport, needs only its first frame, and has no divider', () => {
  const f=fixture({single:true,fixedDivider:true})
  try {
    assert.equal(f.sides.length,1)
    f.sides[0]()
    assert.equal(f.ready(),1)
    assert.equal(f.fits(),1)
    assert.equal(f.host.children.filter(n=>n.props.class?.includes('comparison-line')).length,0)
  } finally {f.app.unmount()}
})
