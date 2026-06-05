# 07 - Godot 适配器实现

## 概述

Godot 适配器是 Engine Adapter 抽象的第一个具体实现。它作为 Godot EditorPlugin 运行，负责 .gs 文件与 Godot 场景树之间的双向同步。

## 插件目录结构

```
addons/g_studio/
├── plugin.cfg                     # 插件描述文件
├── plugin.gd                      # EditorPlugin 主入口
├── gs_file_watcher.gd             # .gs 文件变更检测
├── gs_scene_manager.gd            # 同步管理器（协调各 handler）
├── handlers/
│   ├── base_handler.gd            # Handler 基类
│   ├── scene_region_handler.gd    # type=1: 场景区域
│   ├── tileset_handler.gd         # type=2: 瓦片集（P4）
│   └── sprite_handler.gd          # type=3: 精灵（P4）
└── icons/
    └── gs_icon.svg                # .gs 文件图标
```

## plugin.cfg

```ini
[plugin]

name="G-Studio Bridge"
description="Bidirectional sync between G-Studio .gs files and Godot scenes"
author="G-Studio"
version="0.1.0"
script="plugin.gd"
```

## plugin.gd — 主入口

```gdscript
@tool
extends EditorPlugin

var _watcher: GsFileWatcher
var _manager: GsSceneManager

func _enter_tree():
    _watcher = GsFileWatcher.new()
    _manager = GsSceneManager.new()
    _manager.register_handler(1, SceneRegionHandler.new())
    add_child(_watcher)
    add_child(_manager)
    _watcher.gs_file_changed.connect(_manager.on_gs_changed)

func _exit_tree():
    _watcher.queue_free()
    _manager.queue_free()

func _save_external_data():
    _manager.on_scene_saving()

func _enable_plugin():
    # 提示用户配置 export filter
    if not _has_gs_export_filter():
        push_warning("[G-Studio] 建议在导出预设中添加排除: *.gs")
```

## 结构识别规则（SceneRegionHandler）

### 约定的场景树结构

```
Root (Node2D)
├── Sprite2D                         ← 背景图（受管）
├── Obstacles (Node2D)               ← 遮挡容器（受管）
│   ├── <Name> (Area2D)             ← 遮挡区域（受管）
│   │   └── CollisionPolygon2D      ← 形状
│   └── <Name> (Area2D)
│       └── CollisionShape2D        ← 矩形形状
├── <Name> (StaticBody2D)            ← 碰撞容器（受管）
│   ├── CollisionPolygon2D           ← 碰撞形状
│   └── CollisionShape2D            ← 碰撞矩形
├── Player (其他类型)                 ← 非受管
└── Light2D                          ← 非受管
```

### 识别条件

```gdscript
func _is_occlude_container(node: Node) -> bool:
    return (node.name == "Obstacles"
        and node is Node2D
        and node.get_parent() == node.owner)  # 直接子节点 of 根

func _is_collision_container(node: Node) -> bool:
    return (node is StaticBody2D
        and node.get_parent() == node.owner)  # 直接子节点 of 根

func _is_occlude_region(node: Node) -> bool:
    return (node is Area2D
        and _is_occlude_container(node.get_parent()))

func _is_background_sprite(node: Node) -> bool:
    return (node is Sprite2D
        and node.get_parent() == node.owner)
```

### Group 映射表

```gdscript
const GROUP_MAP = {
    "occlude_top_layer": 1,
    "occlude_y_sort": 2,
    "occlude_screen_mask": 3,
    "occlude_opacity_50": 4,
}

const REVERSE_GROUP_MAP = {
    1: "occlude_top_layer",
    2: "occlude_y_sort",
    3: "occlude_screen_mask",
    4: "occlude_opacity_50",
}
```

## recognize 实现

从场景树提取受管数据，生成 .gs regions 数组：

```gdscript
func recognize(scene_root: Node) -> Dictionary:
    var result = {"regions": [], "texture": ""}

    for child in scene_root.get_children():
        # 背景图
        if _is_background_sprite(child):
            if child.texture:
                result.texture = child.texture.resource_path

        # 遮挡容器
        elif _is_occlude_container(child):
            for area in child.get_children():
                if area is Area2D:
                    var region = _extract_occlude_region(area)
                    if region:
                        result.regions.append(region)

        # 碰撞容器
        elif _is_collision_container(child):
            for shape_node in child.get_children():
                var region = _extract_collision_region(shape_node, child.name)
                if region:
                    result.regions.append(region)

    return result

func _extract_occlude_region(area: Area2D) -> Dictionary:
    var region = {
        "name": area.name,
        "type": 1,  # occlude
        "groups": [],
    }

    # 提取 groups
    for group in area.get_groups():
        if GROUP_MAP.has(group):
            region.groups.append(GROUP_MAP[group])

    # 提取形状
    for child in area.get_children():
        if child is CollisionPolygon2D:
            region["verts"] = _polygon_to_verts(child.polygon)
            break
        elif child is CollisionShape2D and child.shape is RectangleShape2D:
            region["rect"] = _shape_to_rect(child)
            break

    return region if region.has("verts") or region.has("rect") else {}

func _extract_collision_region(node: Node, container_name: String) -> Dictionary:
    if node is CollisionPolygon2D:
        return {
            "name": node.name if node.name != "CollisionPolygon2D" else container_name,
            "type": 2,
            "verts": _polygon_to_verts(node.polygon),
        }
    elif node is CollisionShape2D and node.shape is RectangleShape2D:
        return {
            "name": node.name if node.name != "CollisionShape2D" else container_name,
            "type": 2,
            "rect": _shape_to_rect(node),
        }
    return {}
```

## apply 实现

将 .gs regions 数据应用到场景树（就地更新）：

```gdscript
func apply(regions: Array, scene_root: Node, texture_path: String) -> void:
    # 确保容器存在
    var obstacles = _ensure_obstacles_container(scene_root)
    var collision = _ensure_collision_container(scene_root)
    _ensure_background_sprite(scene_root, texture_path)

    # 分类 regions
    var occlude_regions = regions.filter(func(r): return r.type == 1)
    var collision_regions = regions.filter(func(r): return r.type == 2)

    # 更新遮挡区域
    _sync_occlude_regions(obstacles, occlude_regions)

    # 更新碰撞区域
    _sync_collision_regions(collision, collision_regions)

func _sync_occlude_regions(container: Node, regions: Array) -> void:
    # 建立现有节点 map
    var existing: Dictionary = {}
    for child in container.get_children():
        if child is Area2D:
            existing[child.name] = child

    var processed_names: Array = []

    for region in regions:
        var name = region.name
        processed_names.append(name)

        if existing.has(name):
            # 更新已有节点
            _update_occlude_node(existing[name], region)
        else:
            # 创建新节点
            var node = _create_occlude_node(region)
            container.add_child(node)
            node.owner = container.owner

    # 删除 .gs 中已移除的
    for name in existing:
        if name not in processed_names:
            existing[name].queue_free()
```

## createScene 实现

首次从 .gs 创建完整场景：

```gdscript
func create_scene(data: Dictionary, gs_path: String) -> void:
    var tscn_path = gs_path.replace(".gs", ".tscn")
    var texture_res_path = _resolve_texture_path(gs_path, data.data.texture)

    var root = Node2D.new()
    root.name = data.data.name
    root.y_sort_enabled = data.data.get("y_sort", true)

    # 背景 Sprite2D
    var sprite = Sprite2D.new()
    sprite.name = "Sprite2D"
    sprite.texture = load(texture_res_path)
    if sprite.texture:
        sprite.position = Vector2(sprite.texture.get_width() / 2.0, sprite.texture.get_height() / 2.0)
    root.add_child(sprite)
    sprite.owner = root

    # 应用 regions
    apply(data.data.regions, root, texture_res_path)

    # 设置所有子节点的 owner
    _set_owner_recursive(root, root)

    # 保存为 .tscn
    var packed = PackedScene.new()
    packed.pack(root)
    ResourceSaver.save(packed, tscn_path)
    root.queue_free()

    # 刷新文件系统
    EditorInterface.get_resource_filesystem().scan()
```

## 保存回写流程

```gdscript
# 在 gs_scene_manager.gd 中

func on_scene_saving() -> void:
    var edited_scene = EditorInterface.get_edited_scene_root()
    if not edited_scene:
        return

    var scene_path = edited_scene.scene_file_path
    if not scene_path:
        return

    # 查找关联的 .gs 文件
    var gs_path = scene_path.replace(".tscn", ".gs")
    if not FileAccess.file_exists(gs_path):
        return  # 无关联 .gs → 非受管场景

    # 通过 handler recognize
    var handler = _get_handler_for_gs(gs_path)
    if not handler:
        return

    var recognized = handler.recognize(edited_scene)

    # 读取现有 .gs 数据
    var gs_data = _read_gs_file(gs_path)

    # 更新 regions
    gs_data.data.regions = recognized.regions

    # 如果识别到的 texture 有变化也更新
    if recognized.texture and recognized.texture != "":
        gs_data.data.texture = _to_relative_path(gs_path, recognized.texture)

    # 写入（含冲突检查 + 防循环）
    _write_gs(gs_path, gs_data)
```

## ID 匹配策略

当引擎插件识别场景树中的区域时，需要为每个区域分配 .gs 中的 id：

```gdscript
func _assign_ids(recognized_regions: Array, existing_gs_regions: Array) -> Array:
    # 1. 按名称匹配
    var existing_by_name = {}
    for r in existing_gs_regions:
        existing_by_name[r.name] = r

    var next_id = _get_max_id(existing_gs_regions) + 1

    for region in recognized_regions:
        if existing_by_name.has(region.name):
            # 匹配到已有 → 保留原 id
            region["id"] = existing_by_name[region.name].id
        else:
            # 新区域 → 分配新 id
            region["id"] = "r%d" % next_id
            next_id += 1

    return recognized_regions
```

## Lazy Sync（场景未打开时的处理）

如果 .gs 变更时对应的场景未在编辑器中打开：

```gdscript
var _pending_syncs: Dictionary = {}  # tscn_path → gs_path

func _on_gs_changed(gs_path: String) -> void:
    var tscn_path = gs_path.replace(".gs", ".tscn")

    # 检查场景是否当前打开
    var open_scenes = EditorInterface.get_open_scenes()
    if tscn_path in open_scenes:
        _sync_gs_to_scene(gs_path)
    else:
        # 记录 pending，下次打开时同步
        _pending_syncs[tscn_path] = gs_path

func _on_scene_opened(scene_path: String) -> void:
    if _pending_syncs.has(scene_path):
        var gs_path = _pending_syncs[scene_path]
        _sync_gs_to_scene(gs_path)
        _pending_syncs.erase(scene_path)
```

## 路径转换

.gs 中使用相对路径，Godot 使用 `res://` 路径：

```gdscript
func _resolve_texture_path(gs_path: String, relative_texture: String) -> String:
    # gs_path: "res://assets/scenes/town.gs"
    # relative_texture: "./town.png"
    var gs_dir = gs_path.get_base_dir()  # "res://assets/scenes"
    var resolved = gs_dir.path_join(relative_texture)  # "res://assets/scenes/./town.png"
    return resolved.simplify_path()  # "res://assets/scenes/town.png"

func _to_relative_path(gs_path: String, res_path: String) -> String:
    # 从 res:// 转为相对于 .gs 文件的路径
    var gs_dir = gs_path.get_base_dir()
    # 简化实现：如果在同目录，返回 "./<filename>"
    if res_path.get_base_dir() == gs_dir:
        return "./" + res_path.get_file()
    # 否则计算相对路径
    return _compute_relative(gs_dir, res_path)
```

## 坐标系对应

.gs 中的坐标原点 = 背景图中心。Godot 中 Sprite2D 的 position 设为图片尺寸的一半，这样子节点的坐标就直接对应 .gs 中的坐标。

```gdscript
# 创建场景时
sprite.position = Vector2(texture_width / 2.0, texture_height / 2.0)

# Obstacles 和 StaticBody2D 的 position 也设为同样的值
obstacles.position = sprite.position
collision_body.position = sprite.position

# 这样 Area2D 和 CollisionPolygon2D 中的坐标
# 就直接是相对于图片中心的偏移，与 .gs 中一致
```

## 测试验证清单

- [ ] 创建 .gs → 自动生成 .tscn → Godot 中能正常打开
- [ ] G-Studio 修改区域 → .gs version +1 → Godot 场景更新
- [ ] Godot 中拖动碰撞形状 → 保存 → .gs 中坐标更新
- [ ] Godot 中新建 Area2D（符合规范）→ 保存 → .gs 中出现新 region
- [ ] Godot 中添加非受管节点 → 保存 → .gs 不变，节点保留在 .tscn
- [ ] 快速来回切换 → 无循环触发 → 数据一致
- [ ] .gs 文件手动损坏 → 不崩溃，显示错误提示
