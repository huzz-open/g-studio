const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {RIGHT,UP,YAW}=require('../../src/modules/scene-lighting/model.ts'),{groundSection,simplifyLoop}=require('../../src/shared/godot/ground-footprint.ts')
const PYTHON=process.env.GS_PYTHON||'python'
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
if(!config.snapshot)throw Error('A GS render snapshot is required; export never performs registration')
const snapshot=JSON.parse(fs.readFileSync(config.snapshot,'utf8'))
if(snapshot.format!=='gs-render-snapshot-1')throw Error('Unsupported snapshot format')
const id=config.id,project=path.resolve(config.project),pitch=snapshot.scenePitch,ppu=snapshot.pixelsPerUnit
if(!/^[a-z0-9_-]+$/.test(id)||!fs.existsSync(path.join(project,'project.godot')))throw Error('Asset id / Godot project required')
const locks=path.join(project,'.g-studio/export-locks');fs.mkdirSync(locks,{recursive:true});const lock=path.join(locks,id+'.json')
if(fs.existsSync(lock)){let alive=true;try{const owner=JSON.parse(fs.readFileSync(lock,'utf8'));try{process.kill(owner.pid,0)}catch(e){if(e.code==='ESRCH')alive=false}}catch{}if(alive)throw Error('Another export is running for this asset');fs.unlinkSync(lock)}
fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});process.on('exit',()=>{try{if(JSON.parse(fs.readFileSync(lock,'utf8')).pid===process.pid)fs.unlinkSync(lock)}catch{}})
const bytes=fs.readFileSync(config.model),hash=crypto.createHash('sha256').update(bytes).digest('hex')
const image=path.resolve(config.image),dimensions=JSON.parse(cp.execFileSync(PYTHON,['-c','from PIL import Image; import sys,json; print(json.dumps(Image.open(sys.argv[1]).size))',image],{encoding:'utf8'})),[sourceWidth,sourceHeight]=dimensions
const rgba=cp.execFileSync(PYTHON,['-c','from PIL import Image; import sys; sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("RGBA").tobytes())',image],{maxBuffer:16000000}),sourcePixels={width:sourceWidth,height:sourceHeight,data:new Uint8ClampedArray(rgba)}
const {trimExport}=require("./trim-export.cjs"),{crop,pixels,frame}=trimExport(sourcePixels,snapshot.part.imageFrame),{width,height}=pixels
const binary=fs.readFileSync(snapshot.vertexFile)
if(crypto.createHash('sha256').update(Buffer.concat([Buffer.from(JSON.stringify({part:snapshot.part,scenePitch:snapshot.scenePitch,pixelsPerUnit:snapshot.pixelsPerUnit})),binary])).digest('hex')!==snapshot.snapshotHash)throw Error('Snapshot metadata hash mismatch')
if(crypto.createHash('sha256').update(binary).digest('hex')!==snapshot.geometryHash)throw Error('Snapshot geometry hash mismatch')
if(snapshot.part.model.mesh.sha256!==hash)throw Error('Snapshot source mesh mismatch')
const vertices=new Float32Array(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.length))
const calibrated={vertices,triangles:[]},registration=snapshot.part.model.registration
const vertexCount=vertices.length/9
let top=-Infinity;for(let i=1;i<calibrated.vertices.length;i+=9)top=Math.max(top,calibrated.vertices[i])
const sliceHeight=top*.12,sections=[.02,.04,.06,.08,.1,.12].map(f=>groundSection(calibrated.vertices,top*f)),loops=sections.flat()
let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity
for(const loop of loops)for(const [x,z] of loop){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z)}
const center=[(minX+maxX)/2,0,(minZ+maxZ)/2],a=YAW*Math.PI/180,angle=pitch*Math.PI/180,factor=height/(ppu*frame.height)
const toWorld=p=>[(Math.cos(a)*(p[0]-center[0])-Math.sin(a)*(p[2]-center[2]))*factor,p[1]*factor,(Math.sin(a)*(p[0]-center[0])+Math.cos(a)*(p[2]-center[2]))*factor]
const dot=(p,v)=>p.reduce((s,n,i)=>s+n*v[i],0)
const referenceBasis=require('../../src/modules/scene-lighting/registered-model.ts').registrationBasis(registration?.pitch??pitch)
const anchor=[(dot(center,referenceBasis.right)-frame.left)*height/frame.height,(frame.bottom+frame.height-dot(center,referenceBasis.up))*height/frame.height]
const {bakeFields}=require('./snapshot-fields.cjs'),fields=bakeFields(calibrated,frame,pixels,registration?.pitch??pitch,toWorld)
const toScreen=loop=>loop.map(([x,z])=>{const p=toWorld([x,0,z]);return [p[0]*ppu,p[2]*Math.sin(angle)*ppu]})
const contours=sections.map(group=>group.map(toScreen))
const {rasterFootprint}=require('./footprint-band.cjs')
const polygons=rasterFootprint(contours)
const destination=path.join(project,'assets/gstudio',id),out=path.join(project,'.g-studio/export-staging',id+'-'+crypto.randomUUID());fs.mkdirSync(out,{recursive:true});if(fs.existsSync(destination))fs.cpSync(destination,out,{recursive:true});const res='res://assets/gstudio/'+id
for(const obsolete of ['shadow.obj','shadow.obj.import','surface.obj','surface.obj.import']){try{fs.unlinkSync(path.join(out,obsolete))}catch(e){if(e.code!=='ENOENT')throw e}}
for(const name of ['render_mesh.tres','surface_fields.tres','color.png','normal.png','surface_mask.png','shadow.tscn',id+'.tscn','export.json']){const file=path.join(out,name);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Generated output cannot be a symbolic link: '+name)}
// Write both textures with the SAME crop box; never detect bounds from a normal map.
const writeTexture=(data,file)=>{
 const result=cp.spawnSync(PYTHON,['-c','from PIL import Image; import sys; Image.frombytes("RGBA",(int(sys.argv[1]),int(sys.argv[2])),sys.stdin.buffer.read()).save(sys.argv[3])',String(width),String(height),path.join(out,file)],{input:Buffer.from(data)})
 if(result.error||result.status)throw result.error||Error(String(result.stderr))
}
writeTexture(pixels.data,'color.png')
const normal=cp.spawnSync(PYTHON,['-c','from PIL import Image; import sys,io; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); assert im.size==(int(sys.argv[1]),int(sys.argv[2])), "Normal map dimensions must match source image"; im.crop(tuple(map(int,sys.argv[3:7]))).save(sys.argv[7])',String(sourceWidth),String(sourceHeight),String(crop.x),String(crop.y),String(crop.x+width),String(crop.y+height),path.join(out,'normal.png')],{input:Buffer.from(snapshot.part.normalImage.uri.split(',')[1],'base64')})
if(normal.error||normal.status)throw normal.error||Error(String(normal.stderr))
const mask=Buffer.from(pixels.data)
for(let i=0;i<mask.length;i+=4){mask[i]=mask[i+1]=mask[i+2]=255;mask[i+3]=mask[i+3]>=21?255:0}
writeTexture(mask,'surface_mask.png')
const sourceBasis=require('../../src/modules/scene-lighting/registered-model.ts').registrationBasis(registration?.pitch??pitch),xyz=[],nrm=[],uv=[]
const number=v=>Math.fround(v).toPrecision(9)
for(let i=0;i<vertices.length;i+=9){const p=Array.from(vertices.subarray(i,i+3)),n=Array.from(vertices.subarray(i+3,i+6));xyz.push(...toWorld(p).map(number));nrm.push(...[Math.cos(a)*n[0]-Math.sin(a)*n[2],n[1],Math.sin(a)*n[0]+Math.cos(a)*n[2]].map(number));uv.push(number((dot(p,sourceBasis.right)-frame.left)*height/(frame.height*width)),number((dot(p,sourceBasis.up)-frame.bottom)/frame.height))}
fs.writeFileSync(path.join(out,'render_mesh.tres'),`[gd_resource type="Resource" format=3]\n[ext_resource type="Script" path="res://addons/gstudio_2d/mesh_snapshot.gd" id="script"]\n[resource]\nscript = ExtResource("script")\nsnapshot_hash = "${snapshot.snapshotHash}"\nreference_pitch = ${registration?.pitch??pitch}\nimage_offset = Vector2(${width/2-anchor[0]}, ${height/2-anchor[1]})\npositions = PackedVector3Array(${xyz.join(', ')})\nnormals = PackedVector3Array(${nrm.join(', ')})\nuv = PackedVector2Array(${uv.join(', ')})\n`)
fs.writeFileSync(path.join(out,'shadow.tscn'),`[gd_scene format=3]\n[ext_resource type="Script" path="res://addons/gstudio_2d/shadow_mesh_instance.gd" id="script"]\n[ext_resource type="Resource" path="${res}/render_mesh.tres" id="mesh"]\n[node name="ShadowProxy" type="Node3D"]\n[node name="Geometry" type="MeshInstance3D" parent="."]\nscript = ExtResource("script")\nsnapshot = ExtResource("mesh")\n`)
let scene=`[gd_scene format=3]\n[ext_resource type="Script" path="res://addons/gstudio_2d/gs_asset_2d.gd" id="script"]\n[ext_resource type="Texture2D" path="${res}/color.png" id="color"]\n[ext_resource type="Texture2D" path="${res}/normal.png" id="normal"]\n[ext_resource type="PackedScene" path="${res}/shadow.tscn" id="shadow"]\n[ext_resource type="Texture2D" path="${res}/surface_mask.png" id="mask"]\n[ext_resource type="Resource" path="${res}/render_mesh.tres" id="surface"]\n[ext_resource type="Resource" path="${res}/surface_fields.tres" id="fields"]\n[sub_resource type="CanvasTexture" id="texture"]\ndiffuse_texture = ExtResource("color")\nnormal_texture = ExtResource("normal")\n[node name="${id}" type="Sprite2D"]\ntexture_filter = 1\nscript = ExtResource("script")\ntexture = SubResource("texture")\nbase_texture = ExtResource("color")\nrender_snapshot_hash = "${snapshot.snapshotHash}"\nnormal_texture = ExtResource("normal")\n\n\noffset = Vector2(${width/2-anchor[0]}, ${height/2-anchor[1]})\n\nshadow_proxy_scene = ExtResource("shadow")\nmesh_snapshot = ExtResource("surface")\nsurface_fields = ExtResource("fields")\ndirectx_normal = ${snapshot.part.normal.normalFormat==='directx'}\nsurface_mask = ExtResource("mask")\n[node name="CollisionBody" type="StaticBody2D" parent="."]\ncollision_layer = 2\ncollision_mask = 0\n`
polygons.forEach((poly,i)=>{scene+=`[node name="${i?'Footprint'+i:'Footprint'}" type="CollisionPolygon2D" parent="CollisionBody"]\npolygon = PackedVector2Array(${poly.flat().map(v=>v.toFixed(4)).join(', ')})\n`})
fs.writeFileSync(path.join(out,'surface_fields.tres'),fields.text+'snapshot_hash = "'+snapshot.snapshotHash+'"\n')
fs.writeFileSync(path.join(out,id+'.tscn'),scene)
fs.writeFileSync(path.join(out,'export.json'),JSON.stringify({format:"gs-godot-snapshot-1",gsToGodot:[Math.cos(a)*factor,0,-Math.sin(a)*factor,(-Math.cos(a)*center[0]+Math.sin(a)*center[2])*factor,0,factor,0,0,Math.sin(a)*factor,0,Math.cos(a)*factor,(-Math.sin(a)*center[0]-Math.cos(a)*center[2])*factor,0,0,0,1],godotToGS:[Math.cos(a)/factor,0,Math.sin(a)/factor,center[0],0,1/factor,0,0,-Math.sin(a)/factor,0,Math.cos(a)/factor,center[2],0,0,0,1],snapshotHash:snapshot.snapshotHash,geometrySha256:snapshot.geometryHash,snapshot:config.snapshot,sourceMeshSha256:hash,pixelsPerUnit:ppu,viewElevation:pitch,registration,groundCenter:center,imageAnchor:anchor,groundSliceHeight:sliceHeight,groundSliceFraction:.12,referencePitch:registration?.pitch??pitch,sourceWidth,sourceHeight,textureCrop:crop,outputWidth:width,outputHeight:height,sourceImageCoverage:fields.coverage,collisionPolygons:polygons,triangles:vertexCount/3},null,2))
fs.mkdirSync(path.dirname(destination),{recursive:true})
if(config.inputSha256&&crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex')!==config.inputSha256)throw Error('Source image changed during export')
const backup=path.join(project,'.g-studio/export-backups',id+'-'+crypto.randomUUID());fs.mkdirSync(path.dirname(backup),{recursive:true})
const hadOld=fs.existsSync(destination);if(hadOld)fs.renameSync(destination,backup)
try{fs.renameSync(out,destination)}catch(error){if(hadOld)fs.renameSync(backup,destination);throw error}
console.log(JSON.stringify({asset:res+'/'+id+'.tscn',anchor,polygons:polygons.map(p=>p.length),triangles:vertexCount/3,pitch,yaw:registration?.yaw}))
