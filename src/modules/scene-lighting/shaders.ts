export const meshVertex = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 albedo;
uniform mat4 matrix; uniform vec3 offset; uniform float objectScale;
out vec3 world; out vec3 surfaceNormal; out vec3 surfaceColor;
void main(){world=position*objectScale+offset;surfaceNormal=normal;surfaceColor=albedo;gl_Position=matrix*vec4(world,1.0);}
`
export const depthFragment = `#version 300 es
precision highp float;
in vec3 world; uniform vec3 light; uniform float objectId; uniform float farPlane; uniform float directional;
out vec4 color;
void main(){
  float depth=directional>0.5?min(gl_FragCoord.z,0.99999):min(length(world-light)/farPlane,0.99999);
  vec3 encoded=fract(depth*vec3(1.0,255.0,65025.0));
  encoded-=encoded.yzz*vec3(1.0/255.0,1.0/255.0,0.0);
  color=vec4(encoded,objectId/255.0);
}
`
export const fieldVertex = `#version 300 es
layout(location=0) in vec3 position; layout(location=1) in vec3 normal;
uniform vec3 right; uniform vec3 up; uniform vec3 forward; uniform vec4 bounds;
out float rayDepth; out vec3 fieldNormal;
void main(){
  vec2 uv=(vec2(dot(position,right),dot(position,up))-bounds.xy)/bounds.zw;
  rayDepth=dot(position,forward);fieldNormal=normal;
  gl_Position=vec4(uv*2.0-1.0,rayDepth/16.0,1.0);
}
`
export const fieldFragment = `#version 300 es
precision highp float; in float rayDepth; in vec3 fieldNormal;
layout(location=0) out vec4 depthColor; layout(location=1) out vec4 normalColor;
void main(){
  float d=clamp((rayDepth+16.0)/32.0,0.0,0.99999);
  vec3 encoded=fract(d*vec3(1.0,255.0,65025.0));
  encoded-=encoded.yzz*vec3(1.0/255.0,1.0/255.0,0.0);
  depthColor=vec4(encoded,1.0);normalColor=vec4(normalize(fieldNormal)*0.5+0.5,1.0);
}
`
const lighting = `
uniform vec3 light; uniform samplerCube shadowMap; uniform float farPlane;
uniform float filtered; uniform float shadows; uniform float receives;
uniform float ambient; uniform float power; uniform float visibilityOnly;
uniform float directional; uniform vec3 sunDirection; uniform mat4 sunMatrix; uniform sampler2D sunShadowMap;
float sunSample(vec2 uv,float depth,float bias,float ignoreId){
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return 1.0;
  vec4 packed=texture(sunShadowMap,uv);
  if(ignoreId>0.5&&abs(packed.a*255.0-ignoreId)<0.5)return 1.0;
  float stored=dot(packed.rgb,vec3(1.0,1.0/255.0,1.0/65025.0));
  return depth-bias<=stored?1.0:0.0;
}
float sunVisibility(vec3 p,vec3 n,float ignoreId){
  vec4 clip=sunMatrix*vec4(p,1.0);vec3 q=clip.xyz/clip.w*.5+.5;
  if(q.z<0.0||q.z>1.0)return 1.0;
  float cosine=max(dot(n,sunDirection),0.2);
  float slope=sqrt(max(0.0,1.0-cosine*cosine))/cosine;
  float bias=max(0.0001,(filtered>0.5?0.0013:0.0007)*slope);
  if(filtered<0.5)return sunSample(q.xy,q.z,bias,ignoreId);
  float sum=0.0;
  for(int a=-1;a<=1;a++)for(int b=-1;b<=1;b++)sum+=sunSample(q.xy+vec2(float(a),float(b))/1024.0,q.z,bias,ignoreId)/9.0;
  return sum;
}
float sampleVisibility(vec3 direction,float distance,float bias,float ignoreId){
  vec4 packed=texture(shadowMap,direction);
  if(ignoreId>0.5&&abs(packed.a*255.0-ignoreId)<0.5)return 1.0;
  float stored=dot(packed.rgb,vec3(1.0,1.0/255.0,1.0/65025.0))*farPlane;
  return distance-bias<=stored?1.0:0.0;
}
float visibility(vec3 p,vec3 n,float ignoreId){
  if(shadows<0.5||receives<0.5)return 1.0;
  if(directional>0.5)return sunVisibility(p,n,ignoreId);
  vec3 delta=p-light;float distance=length(delta);vec3 direction=delta/max(distance,0.001);
  float cosine=max(dot(n,-direction),0.2);
  float slope=sqrt(max(0.0,1.0-cosine*cosine))/cosine;
  float bias=max(0.006,distance*(2.0/1024.0)*(filtered>0.5?1.8:0.8)*slope);
  if(filtered<0.5)return sampleVisibility(direction,distance,bias,ignoreId);
  vec3 helper=abs(direction.y)<0.9?vec3(0,1,0):vec3(1,0,0);
  vec3 u=normalize(cross(direction,helper)),v=cross(direction,u);float sum=0.0;
  for(int a=-1;a<=1;a++)for(int b=-1;b<=1;b++)sum+=sampleVisibility(direction+(u*float(a)+v*float(b))*(2.0/1024.0),distance,bias,ignoreId)/9.0;
  return sum;
}
vec3 shade(vec3 base,vec3 p,vec3 n,float ignoreId){
  float vis=visibility(p,n,ignoreId);
  if(visibilityOnly>0.5)return vec3(mix(0.075,0.82,vis));
  vec3 delta=directional>0.5?sunDirection:light-p;float diffuse=max(dot(n,normalize(delta)),0.0);
  vec3 linearColor=base*(ambient+power*diffuse*vis/(directional>0.5?1.0:max(dot(delta,delta),0.4)));
  return pow(clamp(linearColor,0.0,1.0),vec3(1.0/2.2));
}
`
export const surfaceFragment = `#version 300 es
precision highp float;
in vec3 world;in vec3 surfaceNormal;in vec3 surfaceColor;
uniform float room;out vec4 color;
${lighting}
void main(){
  vec3 base=surfaceColor;
  if(room>0.5){
    vec2 grid=abs(fract((abs(surfaceNormal.y)>0.5?world.xz:vec2(abs(surfaceNormal.x)>0.5?world.z:world.x,world.y))+0.5)-0.5);
    float line=1.0-smoothstep(0.007,0.02,min(grid.x,grid.y));base*=mix(1.0,0.8,line);
  }
  color=vec4(shade(base,world,normalize(surfaceNormal),0.0),1.0);
}
`
export const shadowPointVertex = `#version 300 es
layout(location=0) in vec3 position; layout(location=1) in vec3 normal;
uniform mat4 matrix; uniform vec3 offset; uniform float objectScale; uniform float pointSize;
out vec3 world; out vec3 surfaceNormal; out vec3 localPosition;
void main(){
  localPosition=position; world=position*objectScale+offset; surfaceNormal=normal;
  gl_Position=matrix*vec4(world,1.0);
  // A tiny camera-depth bias keeps markers on the surface without drawing through objects.
  gl_Position.z-=0.00002*gl_Position.w; gl_PointSize=pointSize;
}
`
export const shadowPointFragment = `#version 300 es
precision highp float;
in vec3 world; in vec3 surfaceNormal; in vec3 localPosition;
uniform float objectId; uniform float spriteReceiver; uniform sampler2D colorMap;
uniform vec3 right; uniform vec3 up; uniform vec4 bounds;
out vec4 color;
${lighting}
void main(){
  if(length(gl_PointCoord-vec2(0.5))>0.5)discard;
  if(spriteReceiver>0.5){
    vec2 uv=(vec2(dot(localPosition,right),dot(localPosition,up))-bounds.xy)/bounds.zw;
    if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1)))||texture(colorMap,uv).a<0.08)discard;
  }
  vec3 n=normalize(surfaceNormal), toLight=directional>0.5?sunDirection:normalize(light-world);
  // Only external occlusion of a light-facing receiver counts as a shadow landing point.
  if(dot(n,toLight)<=0.0||visibility(world,n,objectId)>0.5)discard;
  color=vec4(0.2,1.0,0.85,1.0);
}
`
export const spriteVertex = `#version 300 es
layout(location=0) in vec2 uvPosition;
uniform mat4 matrix;uniform vec3 offset;uniform vec3 right;uniform vec3 up;uniform vec4 bounds;uniform float objectScale;
out vec2 uv;
void main(){uv=uvPosition;vec2 p=bounds.xy+uv*bounds.zw;gl_Position=matrix*vec4(offset+(right*p.x+up*p.y)*objectScale,1.0);}
`
export const spriteFragment = `#version 300 es
precision highp float;
in vec2 uv;out vec4 color;
uniform sampler2D colorMap;uniform sampler2D normalMap;uniform sampler2D fieldDepth;uniform sampler2D fieldNormal;
uniform vec3 offset;uniform vec3 right;uniform vec3 up;uniform vec3 forward;uniform vec4 bounds;uniform mat4 matrix;uniform float objectId;
uniform float sourceOnly;uniform float objectScale;uniform float directx;uniform float selected;uniform float outlinePixelRatio;
${lighting}
float spriteAlpha(vec2 sampleUv){
  if(any(lessThan(sampleUv,vec2(0)))||any(greaterThanEqual(sampleUv,vec2(1))))return 0.0;
  return texture(colorMap,sampleUv).a;
}
void main(){
  // Evaluate derivatives before alpha discard. The stroke stays two CSS pixels
  // wide at every zoom and follows the same aligned UVs and depth as the image.
  vec2 outlineStep=fwidth(uv)*outlinePixelRatio;
  vec4 texel=texture(colorMap,uv);if(texel.a<0.08)discard;
  if(sourceOnly>0.5){color=vec4(texel.rgb,1.0);return;}
  vec4 field=texture(fieldDepth,uv);
  float d=field.a>0.5?dot(field.rgb,vec3(1.0,1.0/255.0,1.0/65025.0))*32.0-16.0:0.0;
  vec2 q=bounds.xy+uv*bounds.zw;
  vec3 p=offset+(right*q.x+up*q.y+forward*d)*objectScale;
  vec3 n=field.a>0.5?normalize(texture(fieldNormal,uv).xyz*2.0-1.0):-forward;
  vec3 detail=texture(normalMap,uv).xyz*2.0-1.0;
  if(directx>0.5)detail.y=-detail.y;
  // Reorient the complete normal map onto the geometric surface. A flat map
  // preserves n; increasing map strength can now tilt it without a fixed cap.
  vec3 tangent=right-n*dot(right,n);
  if(dot(tangent,tangent)<0.0001)tangent=cross(up,n);
  tangent=normalize(tangent);
  vec3 bitangent=normalize(cross(n,tangent));
  n=normalize(tangent*detail.x+bitangent*detail.y+n*detail.z);
  vec4 clip=matrix*vec4(p,1.0);gl_FragDepth=clip.z/clip.w*0.5+0.5;
  color=vec4(shade(pow(texel.rgb,vec3(2.2)),p,n,field.a>0.5?0.0:objectId),1.0);
  if(selected>0.5){
    float edge=0.0;
    for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
      if(x*x+y*y>4)continue;
      edge=max(edge,1.0-step(0.08,spriteAlpha(uv+vec2(float(x),float(y))*outlineStep)));
    }
    // An inner alpha-contour stroke also marks holes without expanding the
    // sprite quad or painting over foreground occluders and ground shadows.
    color.rgb=mix(color.rgb,vec3(0.72,0.94,0.83),edge);
  }
}
`
