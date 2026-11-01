shader_type canvas_item;
render_mode unshaded;
uniform sampler2D illumination : filter_linear;
uniform vec4 world_rect;
uniform vec3 ambient = vec3(0.22);
uniform bool receives_lighting = true;
varying vec4 tint;
varying vec2 world_position;
void vertex(){tint=COLOR;world_position=(MODEL_MATRIX*vec4(VERTEX,0.0,1.0)).xy;}
void fragment(){vec4 base=texture(TEXTURE,UV)*tint;vec2 uv=(world_position-world_rect.xy)/world_rect.zw;vec3 lit=ambient;if(all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1))))lit+=texture(illumination,uv).rgb;COLOR=vec4(base.rgb*(receives_lighting?lit:vec3(1)),base.a);}
