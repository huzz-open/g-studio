/*
 * Player Occlude Shader
 *
 * 当玩家进入遮挡区域时，对重叠部分做不透明度处理。
 *
 * 原理：
 *   1. GDScript 将遮挡物的 CollisionPolygon2D 顶点（世界坐标）传入
 *   2. 通过 MODEL_MATRIX 将玩家精灵每个像素转为世界坐标
 *   3. 射线法判断像素是否在遮挡多边形内
 *   4. 对多边形内像素采样 screen_texture 获取背景色
 *   5. 可选：通过亮度阈值区分遮挡物和背景（screen_mask 模式）
 *   6. 手动颜色混合，输出 alpha 始终 1.0 避免 alpha 跳变轮廓
 *
 * 分组系统：
 *   occlude_top_layer    — 始终激活（空中遮挡物）
 *   occlude_y_sort       — 按 Y 排序决定前后
 *   occlude_screen_mask  — 亮度检测精确遮罩
 *   occlude_opacity_XX   — 不透明度 0~100%
 */

shader_type canvas_item;

uniform sampler2D screen_texture : hint_screen_texture, filter_nearest;

uniform int point_count = 0;
uniform vec2 poly[64];

group_uniforms occlude_visual;

/** 遮挡区域内玩家的不透明度（0.0 = 完全不可见，1.0 = 完全可见）。
 *  由 occlude_opacity_XX 分组在运行时设置 */
uniform float occlude_opacity : hint_range(0.0, 1.0) = 0.0;

/** 启用背景亮度检测（配合 occlude_screen_mask 分组）。
 *  仅对暗背景位置做处理，跳过路面等亮背景 */
uniform bool use_screen_mask = false;

/** 亮度分界值（仅 use_screen_mask 启用时生效）：
 *  低于此值判定为遮挡物，高于则视为背景不处理 */
uniform float brightness_threshold : hint_range(0.0, 1.0) = 0.45;

/** 精灵纹理 alpha 裁切阈值：低于此值的像素直接丢弃 */
uniform float sprite_alpha_cutoff : hint_range(0.0, 0.5) = 0.01;

varying vec2 frag_world_pos;

void vertex() {
    frag_world_pos = (MODEL_MATRIX * vec4(VERTEX, 0.0, 1.0)).xy;
}

bool point_in_polygon(vec2 p) {
    bool inside = false;
    int j = point_count - 1;
    for (int i = 0; i < point_count; i++) {
        vec2 pi = poly[i];
        vec2 pj = poly[j];
        if ((pi.y > p.y) != (pj.y > p.y) &&
            p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

void fragment() {
    COLOR = texture(TEXTURE, UV);

    if (COLOR.a < sprite_alpha_cutoff) {
        discard;
    }

    if (point_count > 0 && point_in_polygon(frag_world_pos)) {
        vec4 bg = texture(screen_texture, SCREEN_UV);
        bool should_occlude = true;

        if (use_screen_mask) {
            float brightness = dot(bg.rgb, vec3(0.299, 0.587, 0.114));
            should_occlude = brightness < brightness_threshold;
        }

        if (should_occlude) {
            COLOR.rgb = mix(bg.rgb, COLOR.rgb, occlude_opacity);
            COLOR.a = 1.0;
        }
    }
}
