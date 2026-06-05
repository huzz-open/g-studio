# 02 - 引擎适配器抽象层

## 概述

.gs 文件是引擎无关的纯数据格式。将 .gs 数据映射到具体引擎场景树的逻辑，由**引擎适配器（Engine Adapter）**负责。每个引擎（Godot、Unity、Unreal）实现自己的适配器。

适配器运行在**引擎侧**（作为引擎插件的一部分），不运行在 G-Studio 侧。G-Studio 侧只负责读写 .gs 文件。

## 适配器职责

```
.gs data (引擎无关)
    │
    ▼
EngineAdapter (抽象接口)
    │
    ├── GodotAdapter：Obstacles/Area2D/CollisionPolygon2D
    ├── UnityAdapter：(未来) GameObject/PolygonCollider2D
    └── UnrealAdapter：(未来) Actor/UShapeComponent
```

## 抽象接口定义

以下用伪代码描述，各引擎用各自语言实现：

```
interface SceneRegionAdapter {
    // 从引擎场景树中识别出受管区域
    recognize(sceneRoot: EngineNode) -> RecognitionResult

    // 将 .gs regions 数据应用到引擎场景树（就地更新）
    apply(regions: Region[], sceneRoot: EngineNode) -> void

    // 从零创建完整场景树（首次生成时使用）
    createScene(data: SceneRegionData, texturePath: string) -> EngineNode

    // 获取适配器支持的结构识别规则描述（用于文档/调试）
    getRules() -> AdapterRule[]
}

interface RecognitionResult {
    regions: RecognizedRegion[]  // 识别出的受管区域
    backgroundTexture: string?  // 识别出的背景图路径
}

interface RecognizedRegion {
    id: string?          // 如果能从现有数据匹配到 id
    name: string         // 从节点名称读取
    type: RegionType     // occlude 或 collision
    groups: number[]     // 从引擎 group/tag 系统映射
    verts: [number, number][]?  // 多边形顶点
    rect: [number, number, number, number]?  // 矩形
}
```

## 适配器的两个核心操作

### recognize：场景树 → .gs data

当用户在引擎中保存场景时，适配器扫描场景树：

1. 按**结构规则**判断哪些节点属于"受管"范畴
2. 从受管节点中提取属性（顶点、groups 等）
3. 将提取结果转换为 .gs 格式的 regions 数组
4. 不匹配规则的节点视为"非受管"，完全忽略

### apply：.gs data → 场景树

当 .gs 文件被外部修改时，适配器将变更应用到场景树：

1. 读取新的 regions 数组
2. 在场景树中查找现有的受管容器节点
3. 对比并执行增删改：
   - 新增的 region → 创建对应引擎节点
   - 删除的 region → 移除对应引擎节点
   - 修改的 region → 更新节点属性
4. 非受管节点不受影响

## 结构识别规则的设计原则

每个适配器定义自己的"结构规则"，规则必须满足：

1. **确定性**：给定同一个场景树，识别结果必须一致
2. **非侵入性**：不依赖隐藏 metadata 或自定义属性，仅靠节点类型 + 名称 + 层级判断
3. **可手工构建**：用户可以在引擎中完全手动搭建符合规则的结构
4. **低误识别率**：规则条件足够严格，不会意外将普通节点识别为受管节点
5. **脱管可退出**：用户通过改名或改变层级即可让节点脱离管理

## 适配器 × 类型矩阵

不同的 .gs type 需要不同的适配器处理逻辑：

| .gs type | GodotAdapter | UnityAdapter |
|----------|-------------|-------------|
| SceneRegion (1) | scene_region_handler.gd | (未来) |
| Tileset (2) | tileset_handler.gd | (未来) |
| Sprite (3) | sprite_handler.gd | (未来) |

每个 handler 是适配器的一个子模块，处理特定 type 的 .gs 文件。

## 适配器注册机制

引擎插件启动时注册 handler：

```
# Godot 插件伪代码
func _enter_tree():
    register_handler(GsType.SceneRegion, SceneRegionHandler.new())
    register_handler(GsType.Tileset, TilesetHandler.new())
    register_handler(GsType.Sprite, SpriteHandler.new())
```

收到 .gs 文件变更时，根据 `type` 字段分发给对应 handler。

## 与 G-Studio 侧的边界

G-Studio 侧（浏览器端）**不需要**知道适配器的存在。它只负责：
- 读写 .gs 文件的 `data` 字段
- 展示和编辑业务数据（regions、tiles、sprites）
- 通过 visibilitychange 检测外部修改并刷新

适配器逻辑完全在引擎侧。G-Studio 和引擎插件之间的"协议"就是 .gs 文件本身。

## 扩展新引擎的步骤

1. 创建引擎插件项目
2. 实现 .gs 文件读取（JSON 解析）
3. 实现 file watcher（监听 .gs 文件变更）
4. 为每个支持的 GsType 实现对应的 handler（含结构规则定义）
5. 实现保存回写（场景保存时 → 识别受管节点 → 写回 .gs）
6. 实现防循环机制（避免自己写 .gs 后又触发读取）
