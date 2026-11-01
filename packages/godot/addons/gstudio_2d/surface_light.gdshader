shader_type spatial;
render_mode cull_disabled;
uniform sampler2D source_mask : filter_nearest, repeat_disable;
uniform sampler2D detail_normal : hint_normal, filter_linear, repeat_disable;
uniform sampler2D surface_position : filter_nearest, repeat_disable;
uniform sampler2D surface_normal : filter_nearest, repeat_disable;
uniform mat4 asset_transform;
uniform bool use_detail_normal = false;
uniform float reference_pitch = 0.34906585;
uniform bool directx_normal = false;
void fragment(){
 if(texture(source_mask,UV).a<0.08)discard;
 vec4 point=texture(surface_position,UV);
 ALBEDO=point.a>0.5?vec3(1):vec3(0);ROUGHNESS=1.0;SPECULAR=0.0;
 if(point.a>0.5){
  vec3 n=normalize(texture(surface_normal,UV).xyz);
  if(use_detail_normal){
   vec3 detail=texture(detail_normal,UV).xyz*2.0-1.0;if(directx_normal)detail.y=-detail.y;
   vec3 t=vec3(1,0,0)-n*n.x;if(dot(t,t)<0.0001)t=cross(vec3(0,cos(reference_pitch),-sin(reference_pitch)),n);t=normalize(t);
   n=normalize(t*detail.x+normalize(cross(n,t))*detail.y+n*detail.z);
  }
  LIGHT_VERTEX=(VIEW_MATRIX*asset_transform*vec4(point.xyz,1)).xyz;
  NORMAL=normalize(mat3(VIEW_MATRIX)*mat3(asset_transform)*n);
 }
}
