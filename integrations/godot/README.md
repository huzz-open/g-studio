# G-Studio Godot 插件

这里集中存放 Godot 侧的编辑器插件和运行时遮挡组件。前端的场景导出实现仍在 [`src/shared/godot/`](../../src/shared/godot/) 和 [`src/modules/scene-region-editor/`](../../src/modules/scene-region-editor/)。

## 目录

```text
addons/g_studio/
├── plugin.cfg
├── plugin.gd
├── gs_scene_manager.gd
├── handlers/
│   └── scene_region_handler.gd
└── runtime/
    ├── occlude_handler.gd
    └── shaders/
        └── occlude.gdshader
```

## 安装

1. 将本目录下的整个 `addons/g_studio/` 复制到目标 Godot 4 项目的 `addons/g_studio/`。
2. 在 Godot 的项目设置 → 插件中启用 **G-Studio Bridge**。
3. 将 G-Studio 保存的场景区域 `.gs` 文件和它引用的图片放入该游戏项目。`.gs` 文件应位于 `addons/` 和隐藏目录之外，插件扫描时会跳过这些目录。

仓库中的路径是 `integrations/godot/addons/g_studio/`，安装后的路径是 `res://addons/g_studio/`。`res://` 指目标游戏项目根目录。

## 场景同步

插件目前只注册了场景区域类型（`.gs` 的 `type = 1`），支持背景图、矩形和多边形遮挡／碰撞区域。

- 启用时进行首次同步，随后每 2 秒检查 `.gs` 文件变化。
- `.gs` 与同目录、同名的 `.tscn` 配对；图片路径相对于 `.gs` 文件解析。
- `.gs` 更新时创建或更新场景；保存当前 Godot 场景时，将识别到的区域写回已有的 `.gs`。
- 受管结构是根节点下的背景 `Sprite2D`、`Obstacles` 遮挡容器和名为 `Collision` 的 `StaticBody2D` 碰撞容器。
- 同步按区域名称匹配节点。编辑时应避免在两端同时保留未保存的修改。

## 运行时遮挡

插件同步区域和分组，角色上的遮挡组件需要手动配置：

1. 在角色下添加 `Node` 子节点，挂载 `runtime/occlude_handler.gd`。
2. 为组件指定角色的 `Sprite2D` 和检测用 `Area2D`；未指定时，组件会尝试从同级节点中查找。
3. 配置检测区域的形状、监测和碰撞层／掩码，使它能检测场景中的遮挡 `Area2D`。

组件通过脚本相对路径加载 `runtime/shaders/occlude.gdshader`，无需在游戏项目根目录额外创建 `shaders/`。

支持的区域分组：

| 分组 | 行为 |
| --- | --- |
| `occlude_top_layer` | 进入区域后启用遮挡，不比较角色 Y 坐标 |
| `occlude_y_sort` | 根据角色 Y 坐标与遮挡多边形底部判断前后关系 |
| `occlude_screen_mask` | 使用背景亮度进一步筛选需要遮挡的像素 |
| `occlude_opacity_XX` | 设置遮挡区域内角色的不透明度，`XX` 为 0～100 |

如果角色已有 `ShaderMaterial`，组件不会替换它。需要参考随附的 Shader，将遮挡逻辑和对应的 uniform 参数合并到自定义 Shader 中。

此目录只提供插件与组件，不包含完整游戏示例。历史设计方案见 [`docs/design/engine-bridge/`](../../docs/design/engine-bridge/)，实际行为以当前源码为准。
