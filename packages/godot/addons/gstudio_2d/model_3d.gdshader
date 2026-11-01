shader_type spatial;
render_mode cull_disabled;
uniform sampler2D source_image : source_color, filter_nearest, repeat_disable;
uniform sampler2D detail_normal : hint_normal, filter_linear, repeat_disable;
uniform bool textured = true;
uniform bool use_normal_map = true;
void fragment(){
 vec2 p=vec2(UV.x,1.0-UV.y);
 ALBEDO=vec3(0.42,0.44,0.46);ROUGHNESS=1.0;SPECULAR=0.0;
 if(textured&&all(greaterThanEqual(p,vec2(0)))&&all(lessThanEqual(p,vec2(1)))){
  vec4 source=texture(source_image,p);
  if(source.a>0.08){ALBEDO=source.rgb;if(use_normal_map)NORMAL_MAP=texture(detail_normal,p).rgb;}
 }
}
