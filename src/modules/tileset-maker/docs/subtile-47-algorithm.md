# SubTile 47 算法设计文档

## 概述

本文档描述 G-Studio 瓦片集制作器中 **SubTile（子瓦片）模式** 的核心算法。该算法从一张 3×3 九宫格源图生成完整的 47-tile Blob Tileset，支持 8-neighbor autotiling。

---

## 1. 输入与输出

### 输入

一张 **3W × 3H** 的九宫格源图（W、H 为偶数），表示地形的最小完整矩形：

```
┌─────┬─────┬─────┐
│ TL  │ Top │ TR  │  ← 3 cells 宽
├─────┼─────┼─────┤
│Left │ Mid │Right│  ← 每 cell = W×H px
├─────┼─────┼─────┤
│ BL  │ Bot │ BR  │
└─────┴─────┴─────┘
    总尺寸: 3W × 3H
```

例如 72×72 像素 → W=24, H=24, 每个子瓦片 12×12。

### 输出

一张包含 47 个瓦片的 atlas 图集，布局支持：
- **8×6**（47 tiles + 1 空位 = 48 格）
- **11×5**（45 tiles，部分行不满）

每个输出瓦片尺寸 W×H（即 2 个子瓦片宽 × 2 个子瓦片高）。

---

## 2. 核心原理：6×6 子瓦片分解

将 3W×3H 源图均匀切割为 **6×6 = 36 个子瓦片**（每个 W/2 × H/2）：

```
源图 6×6 子瓦片网格:
     col0  col1  col2  col3  col4  col5
row0 [OC ] [   ] [   ] [   ] [   ] [OC ]  ← 外角 + 边缘
row1 [   ] [   ] [   ] [   ] [   ] [   ]
row2 [   ] [   ] [INT] [INT] [   ] [   ]  ← 内部（INT）在中心
row3 [   ] [   ] [INT] [INT] [   ] [   ]
row4 [   ] [   ] [   ] [   ] [   ] [   ]
row5 [OC ] [   ] [   ] [   ] [   ] [OC ]  ← 外角 + 边缘

OC = Outer Corner（外角，也用于生成内角）
INT = Interior（内部/全连通区域）
其余 = Edge（边缘过渡区域）
```

**全部 36 个子瓦片都被使用**，外圈不再丢弃。

---

## 3. 象限映射规则

每个输出瓦片由 4 个象限（TL/TR/BL/BR）拼合，每个象限根据 peering 状态从 6×6 网格中选取子瓦片。

### 每象限 5 种状态

| 状态 | 条件 | 子瓦片来源 |
|------|------|-----------|
| outerCorner | 两个正交邻居都空 | 源图角落 cell 的外侧象限 |
| edgeA | A方向空, B方向有 | 源图边缘 cell 的外侧部分 |
| edgeB | A方向有, B方向空 | 源图边缘 cell 的外侧部分 |
| interior | 两正交邻居+对角都连 | 源图中心 cell 的对应象限 |
| innerCorner | 两正交邻居连, 对角空 | **外角子瓦片 flip180** |

### 完整坐标映射表

```
TL象限 (检查 T, L, TL):
  outerCorner  (!T && !L)        → (row0, col0)
  edgeA        (!T &&  L)        → (row0, col2)
  edgeB        ( T && !L)        → (row2, col0)
  innerCorner  ( T &&  L && !TL) → flip180(row0, col0)
  interior     ( T &&  L &&  TL) → (row2, col2)

TR象限 (检查 T, R, TR):
  outerCorner  (!T && !R)        → (row0, col5)
  edgeA        (!T &&  R)        → (row0, col3)
  edgeB        ( T && !R)        → (row2, col5)
  innerCorner  ( T &&  R && !TR) → flip180(row0, col5)
  interior     ( T &&  R &&  TR) → (row2, col3)

BL象限 (检查 B, L, BL):
  outerCorner  (!B && !L)        → (row5, col0)
  edgeA        (!B &&  L)        → (row5, col2)
  edgeB        ( B && !L)        → (row3, col0)
  innerCorner  ( B &&  L && !BL) → flip180(row5, col0)
  interior     ( B &&  L &&  BL) → (row3, col2)

BR象限 (检查 B, R, BR):
  outerCorner  (!B && !R)        → (row5, col5)
  edgeA        (!B &&  R)        → (row5, col3)
  edgeB        ( B && !R)        → (row3, col5)
  innerCorner  ( B &&  R && !BR) → flip180(row5, col5)
  interior     ( B &&  R &&  BR) → (row3, col3)
```

> 注：`T/R/B/L = true` 表示该方向有地形连接（peering 值为 0）

---

## 4. 内角生成：flip180

3×3 九宫格源图天然不包含"内角"形态（凹弧）。通过对外角子瓦片做 **180° 旋转**（水平翻转 + 垂直翻转）生成：

```
外角 (凸弧):              内角 (凹弧):
┌───────────┐            ┌───────────┐
│ bg    bg  │            │ terrain   │
│   bg      │ ─flip180→ │      bg   │
│    terrain│            │ bg    bg  │
└───────────┘            └───────────┘
背景多, 地形少            地形多, 背景少
```

flip180 像素操作：逐行逆序 + 行内逆序

```typescript
function flip180(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4
      const dstIdx = ((h - 1 - y) * w + (w - 1 - x)) * 4
      out[dstIdx]     = src[srcIdx]
      out[dstIdx + 1] = src[srcIdx + 1]
      out[dstIdx + 2] = src[srcIdx + 2]
      out[dstIdx + 3] = src[srcIdx + 3]
    }
  }
  return out
}
```

4 个内角子瓦片：
- innerCornerTL = flip180(tile at row0,col0)
- innerCornerTR = flip180(tile at row0,col5)
- innerCornerBL = flip180(tile at row5,col0)
- innerCornerBR = flip180(tile at row5,col5)

---

## 5. Peering 系统

### 8-neighbor 连接编码

```typescript
type Peering = [T, TR, R, BR, B, BL, L, TL]
// 值: 0 = 连接(有地形), -1 = 不连接(无地形)
```

### 47 种有效状态

对角连接仅在两个正交邻居都连接时才有意义（否则视为不连接），因此 256 种可能的 8-bit 组合归纳为 47 种有效 peering 状态，存储在 `TILE_PEERINGS[0..46]`。

### Peering 到 Bitmask 转换

```
Bit layout: NW=1, N=2, NE=4, W=8, E=16, SW=32, S=64, SE=128
Peering:    [T=N, TR=NE, R=E, BR=SE, B=S, BL=SW, L=W, TL=NW]
```

---

## 6. 数据流 Pipeline

```
输入: 3W×3H 九宫格源图 (Uint8ClampedArray)
  │
  ▼
[magenta 处理] ← 可选: 将品红色替换为透明
  │
  ▼
[slicer] ─────────────────────────────────────────────┐
  │ 切 6×6 = 36 子瓦片                                │
  │ 生成 4 个 flip180 内角子瓦片                        │
  ▼                                                    │
SubTileGrid {                                          │
  tiles: Uint8ClampedArray[36]                         │
  innerCornerTiles: Uint8ClampedArray[4]  ← [TL,TR,BL,BR]
  halfW, halfH, tileW, tileH                           │
}                                                      │
  │                                                    │
  ▼                                                    │
[mapper] × 47 tiles                                    │
  │ 对每个 peering state:                               │
  │   对每个象限 (tl/tr/bl/br):                         │
  │     → getSubTileForQuadrant() → SubTileCoord       │
  │     → coord.row==-1 ? innerCornerTiles[col] : tiles[row*6+col]
  │                                                    │
  ▼                                                    │
[generator] 拼合为输出 atlas                             │
  │ 按 layout (8×6 或 11×5) 排列                       │
  ▼                                                    │
输出: atlas 像素 + 尺寸信息
```

---

## 7. 代码结构

```
src/modules/tileset-maker/core/
├── types.ts              # 类型定义 (Peering, SubTileCoord, SubTileGrid, TilesetLayout...)
├── peerings.ts           # TILE_PEERINGS[47], bitmask 转换函数
├── layouts.ts            # LAYOUT_8X6, LAYOUT_11X5, getLayout()
├── generator.ts          # 统一入口: generateTileset() → 分发 SDF/SubTile
│
├── subtile/
│   ├── mapper.ts         # 象限映射: getSubTileForQuadrant(), isInnerCorner()
│   ├── slicer.ts         # 切片: sliceSubTiles(), flip180()
│   ├── generator-subtile.ts  # SubTile 模式生成器: generateTilesetSubtile()
│   └── magenta.ts        # 品红色→透明预处理
│
└── sdf/                  # SDF 模式 (与本文档无关)
    ├── render-sdf.ts
    ├── sdf.ts
    ├── filter.ts
    └── profiles.ts
```

### 关键接口

```typescript
// types.ts
interface SubTileGrid {
  tiles: Uint8ClampedArray[]            // 36 个子瓦片 (6×6 row-major)
  innerCornerTiles: Uint8ClampedArray[] // 4 个内角 [TL, TR, BL, BR]
  halfW: number                         // 子瓦片宽 = sourceWidth / 6
  halfH: number                         // 子瓦片高 = sourceHeight / 6
  tileW: number                         // 输出瓦片宽 = halfW * 2
  tileH: number                         // 输出瓦片高 = halfH * 2
}

// mapper.ts
function getSubTileForQuadrant(quadrant: 'tl'|'tr'|'bl'|'br', peering: Peering): SubTileCoord
function isInnerCorner(coord: SubTileCoord): boolean
// 内角标记: row === -1, col 为 innerCornerTiles 索引 (0-3)

// generator-subtile.ts
function generateTilesetSubtile(
  sourcePixels: Uint8ClampedArray,
  sourceWidth: number, sourceHeight: number,
  layout: TilesetLayout,
  options: { useMagenta: boolean; magentaTolerance: number }
): { pixels, width, height, tileW, tileH }
```

---

## 8. 统一入口调用方式

```typescript
import { generateTileset } from './core/generator'
import { getLayout } from './core/layouts'

const result = generateTileset({
  mode: 'subtile',
  sourcePixels,           // 3W×3H 九宫格 RGBA 像素
  sourceWidth: 72,
  sourceHeight: 72,
  layout: getLayout('8x6'),
  useMagenta: false,
  magentaTolerance: 30,
})
// result.pixels: Uint8ClampedArray (atlas RGBA)
// result.width / result.height: atlas 总尺寸
// result.tileW / result.tileH: 单瓦片尺寸
```

---

## 9. 约束条件

1. **源图尺寸必须被 6 整除** — 保证每个子瓦片为整数像素
2. **宽高推荐为 tile 尺寸的 3 倍** — 如 tile=24 → 源图=72×72
3. **Peering 编码中对角仅在两正交邻居都连时才有效** — 否则对角值被忽略
4. **内角通过 flip180 生成** — 源图本身不包含凹弧形态

---

## 10. 验证工具

项目包含独立验证程序 `tmp-test/`：

```
tmp-test/
├── index.html          # 可视化页面
├── subtile-test.js     # 算法的纯 JS 镜像实现
└── SNOW_H.png          # 测试用 72×72 九宫格源图
```

功能：
- **源图展示** — 显示输入九宫格
- **6×6 子瓦片分解** — 可视化各子瓦片角色（外角/边缘/内部），**支持拖拽网格线**实时调整分割位置
- **Atlas 生成** — 生成并展示完整 tileset，支持 8×6 / 11×5 布局切换
- **TileMap 渲染** — 使用生成的 atlas 绘制测试地图，覆盖 L形、U形、十字、孤岛等典型场景

用浏览器直接打开 `tmp-test/index.html`（需 HTTP 服务器环境，如 `npx serve tmp-test`）。

---

## 11. 设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 子瓦片分解粒度 | 6×6 (全部使用) | 源图所有像素都承载地形信息，丢弃外圈会丢失边框装饰 |
| 内角生成方式 | flip180 外角 | 业界标准做法 (Blobator, Tilewise)，风格自然一致 |
| Atlas 布局 | 8×6 / 11×5 可选 | 兼容不同引擎导入需求 |
| 品红背景处理 | 可选预处理 | 兼容旧资源中使用品红作透明标记的工作流 |
| 对角连接规则 | 正交邻居都连时才检查 | 47-tile 标准，避免无效组合 |
