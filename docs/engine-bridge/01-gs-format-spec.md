# 01 - .gs 文件格式规范

## 概述

`.gs` 是 G-Studio 的核心数据文件格式。它是一个 JSON 文件，存储 G-Studio 各模块的业务数据。引擎插件和 G-Studio 双端读写其中的 `data` 字段。

## 设计约束

- **引用式**：通过相对路径引用外部资源（图片等），不内嵌二进制数据
- **引擎无关**：不包含任何引擎特有的数据结构
- **紧凑**：使用枚举数值代替字符串，减小文件体积
- **可 diff**：JSON 格式，适合 git 版本控制

## 文件顶层结构

```typescript
interface GsFile {
  gs: number       // 格式版本号，当前固定为 1
  type: GsType     // 文件类型枚举
  gen: string      // 生成工具标识，如 "g-studio/0.5.0" 或 "godot-plugin/1.0.0"
  version: number  // 内容版本号，每次写入递增，驱动双向同步
  data: unknown    // 业务数据，结构由 type 决定
}
```

## GsType 枚举

```typescript
enum GsType {
  SceneRegion = 1,  // 场景区域（碰撞/遮挡）
  Tileset = 2,      // 瓦片集
  Sprite = 3,       // 精灵切分
  WorldMap = 4,     // 世界地图
}
```

## version 字段语义

- 初始值为 `1`（创建时）
- 每次任何端写入时 `version + 1`
- 用于冲突检测：写入前检查磁盘上的 version 是否等于上次读取的值
- 如果磁盘 version > 内存 version → 文件被另一端修改过 → 冲突

## type=1 SceneRegion 数据结构

```typescript
interface SceneRegionData {
  name: string               // 场景名称（用于引擎中的根节点命名）
  texture: string            // 背景图相对路径（相对于 .gs 文件位置）
  size: [number, number]     // 背景图尺寸 [width, height]
  y_sort: boolean            // 是否启用 Y 轴排序
  regions: SceneRegion[]     // 区域列表
}

interface SceneRegion {
  id: string                 // 唯一标识（如 "r1", "r2"），创建时生成，不可变
  name: string               // 区域显示名称（同时用于引擎节点命名）
  type: RegionType           // 区域类型枚举
  groups?: RegionGroup[]     // 分组（仅 occlude 类型使用）
  verts?: [number, number][] // 多边形顶点（与 rect 互斥）
  rect?: [number, number, number, number]  // 矩形 [x, y, w, h]（与 verts 互斥）
}
```

### RegionType 枚举

```typescript
enum RegionType {
  Occlude = 1,    // 遮挡区域
  Collision = 2,  // 碰撞区域
}
```

### RegionGroup 枚举

```typescript
enum RegionGroup {
  TopLayer = 1,      // 始终遮挡（occlude_top_layer）
  YSort = 2,         // Y轴排序（occlude_y_sort）
  ScreenMask = 3,    // 像素遮罩（occlude_screen_mask）
  Opacity50 = 4,     // 半透明遮挡（occlude_opacity_50）
}
```

## type=2 Tileset 数据结构（规划）

```typescript
interface TilesetData {
  name: string
  texture: string
  tileSize: [number, number]
  terrains: TileTerrain[]
  tiles: TileDefinition[]
}
```

## type=3 Sprite 数据结构（规划）

```typescript
interface SpriteData {
  name: string
  texture: string
  frameSize: [number, number]
  animations: SpriteAnimation[]
}
```

## 完整示例

```json
{
  "gs": 1,
  "type": 1,
  "gen": "g-studio/0.5.0",
  "version": 4,
  "data": {
    "name": "QingFengZhen",
    "texture": "./qingfengzhen.png",
    "size": [3072, 2160],
    "y_sort": true,
    "regions": [
      {
        "id": "r1",
        "name": "NoticeBoard",
        "type": 1,
        "groups": [2, 4],
        "verts": [[-512, -176], [-400, -208], [-368, -160], [-355, -153]]
      },
      {
        "id": "r2",
        "name": "Wall",
        "type": 2,
        "verts": [[396, -584], [250, -537], [222, -555]]
      },
      {
        "id": "r3",
        "name": "Gate",
        "type": 2,
        "rect": [100, 200, 67, 61]
      }
    ]
  }
}
```

## ID 生成规则

区域 ID 格式为 `r` + 递增数字（如 `r1`, `r2`, `r3`）。

- G-Studio 创建区域时：取当前 regions 中最大数字 + 1
- 引擎插件创建区域时（用户在引擎中手动添加了符合规范的节点）：同样取最大值 + 1
- ID 一旦生成不可修改（即使区域被重命名）

## 坐标系

所有坐标使用**像素坐标**，原点为背景图的中心点：
- X 轴：向右为正
- Y 轴：向下为正
- 这与 Godot 的坐标系一致（Sprite2D position 设为图片中心时，子节点坐标即为相对于图片中心的偏移）

## 路径解析

`data.texture` 使用相对路径，相对于 .gs 文件所在目录：
- `"./qingfengzhen.png"` → 同目录下的 qingfengzhen.png
- `"../textures/bg.png"` → 上级目录的 textures/bg.png

引擎插件负责将此相对路径转换为引擎内部路径格式（如 Godot 的 `res://`）。

## 校验规则

读取 .gs 文件时应验证：

1. `gs` 字段存在且为支持的版本号（当前仅 1）
2. `type` 字段存在且为已知枚举值
3. `version` 字段存在且为正整数
4. `data` 字段存在且结构符合对应 type 的 schema
5. 对于 SceneRegion：每个 region 有唯一 id、有效 type、verts 或 rect 至少一个存在

校验失败时应报错并拒绝加载，不做静默降级。
