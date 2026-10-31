import { BufferGeometry, DirectionalLight, DoubleSide, HemisphereLight, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { buildPartModel, activeRepair } from '../../modules/scene-lighting/part-model'
import type { PartAsset, PartModel } from './schema'

export interface ModelPreviewTarget { model: PartModel; canvas: HTMLCanvasElement }

const thumbnails=new Map<string,string>()
/** One context animates visible cards only. Cached posters keep reopening immediate. */
export function createModelCardPreview(part:PartAsset,targets:ModelPreviewTarget[],viewport:HTMLElement){
  let disposed=false,working=false,renderer:WebGLRenderer|undefined,frame=0,last=0,angle=.4
  const queue:ModelPreviewTarget[]=[],visible=new Set<ModelPreviewTarget>(),queued=new Set<ModelPreviewTarget>()
  const controller=new AbortController(),motion=matchMedia('(prefers-reduced-motion: reduce)')
  const material=new MeshStandardMaterial({color:0xc5d8cb,roughness:.78,side:DoubleSide})
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,.01,100)
  scene.add(new HemisphereLight(0xe8f3ff,0x435348,2.4))
  const light=new DirectionalLight(0xffedd4,3.1);light.position.set(3,5,4);scene.add(light)
  type Preview={mesh:Mesh<BufferGeometry,MeshStandardMaterial>;radius:number}
  const models=new Map<string,Preview>(),ready=new Map<ModelPreviewTarget,Preview>()
  const key=(target:ModelPreviewTarget)=>JSON.stringify([target.model.mesh?.sha256,target.model.size,target.model.original,target.model.imageFit,target.model.repair?.key])
  function draw(target:ModelPreviewTarget,preview:Preview){
    renderer??=new WebGLRenderer({antialias:true,alpha:true});renderer.setClearColor(0,0);renderer.setSize(240,160,false)
    const {mesh,radius}=preview,extent=radius*1.18
    camera.left=-extent*1.5;camera.right=extent*1.5;camera.top=extent;camera.bottom=-extent;camera.position.set(0,radius*1.5,radius*4);camera.near=radius*.01;camera.far=radius*10;camera.lookAt(0,0,0);camera.updateProjectionMatrix()
    mesh.rotation.y=angle;scene.add(mesh);renderer.render(scene,camera);scene.remove(mesh)
    const ctx=target.canvas.getContext('2d');ctx?.clearRect(0,0,240,160);ctx?.drawImage(renderer.domElement,0,0);target.canvas.dataset.previewState='ready'
  }
  function animate(time:number){
    frame=0;if(disposed||document.hidden)return
    if(time-last>=1000/24){angle+=last?Math.min(time-last,100)*.00045:0;last=time;for(const target of visible){const preview=ready.get(target);if(preview)draw(target,preview)}}
    if(!motion.matches&&[...visible].some(target=>ready.has(target)))frame=requestAnimationFrame(animate)
  }
  function refresh(){cancelAnimationFrame(frame);frame=0;last=0;if(!disposed&&!document.hidden&&visible.size)frame=requestAnimationFrame(animate)}
  async function prepare(target:ModelPreviewTarget){
    const canvas=target.canvas,k=key(target);canvas.width=240;canvas.height=160
    const poster=thumbnails.get(k)
    if(poster){const image=new Image();image.src=poster;await image.decode();if(disposed)return;canvas.getContext('2d')?.drawImage(image,0,0);canvas.dataset.previewState='ready'}
    let preview=models.get(k)
    if(!preview){
      const asset={...part,model:target.model},pixels={width:0,height:0,data:new Uint8ClampedArray()}
      const decoded=activeRepair(asset)?await(await import('../../modules/scene-lighting/part-model-async')).buildPartModelAsync(asset,pixels,controller.signal):buildPartModel(asset,pixels)
      if(disposed)return
      const buffers=new BufferGeometry(),buffer=new InterleavedBuffer(decoded.vertices.slice(),9)
      buffers.setAttribute('position',new InterleavedBufferAttribute(buffer,3,0));buffers.setAttribute('normal',new InterleavedBufferAttribute(buffer,3,3))
      buffers.computeBoundingBox();const center=buffers.boundingBox!.getCenter(new Vector3());buffers.translate(-center.x,-center.y,-center.z);buffers.computeBoundingSphere()
      preview={mesh:new Mesh(buffers,material),radius:Math.max(.001,buffers.boundingSphere!.radius)};models.set(k,preview)
    }
    ready.set(target,preview)
    for(const [oldKey,old] of models){
      if(models.size<=8)break
      if([...visible].some(t=>ready.get(t)===old))continue
      models.delete(oldKey);for(const [t,p] of ready)if(p===old)ready.delete(t);old.mesh.geometry.dispose()
    }
    if(visible.has(target)){draw(target,preview);if(!poster){thumbnails.set(k,canvas.toDataURL());if(thumbnails.size>48)thumbnails.delete(thumbnails.keys().next().value!)}refresh()}
  }
  async function drain(){
    if(working||disposed)return;working=true
    while(queue.length&&!disposed){await new Promise(resolve=>setTimeout(resolve,16));if(disposed)break;const target=queue.shift()!;queued.delete(target);if(!visible.has(target))continue;try{await prepare(target)}catch{if(!disposed)target.canvas.dataset.previewState='error'}}
    working=false
  }
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const target=targets.find(t=>t.canvas===entry.target);if(!target)continue
      if(entry.isIntersecting){visible.add(target);if(!ready.has(target)&&!queued.has(target)){queue.push(target);queued.add(target)}}else visible.delete(target)
    }void drain();refresh()
  },{root:viewport})
  targets.forEach(target=>observer.observe(target.canvas))
  document.addEventListener('visibilitychange',refresh);motion.addEventListener('change',refresh)
  return()=>{disposed=true;controller.abort();cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',refresh);motion.removeEventListener('change',refresh);models.forEach(p=>p.mesh.geometry.dispose());renderer?.dispose();renderer?.forceContextLoss();material.dispose()}
}
