# SubTile 47 算法

从九宫格源图生成 47 种有效地形连接状态。本文描述当前子瓦片实现；SDF 模式使用独立算法。

[文档索引](../../../../docs/README.md) · [生成入口](../core/generator.ts) · [子瓦片生成器](../core/subtile/generator-subtile.ts)

## 输入与输出

常规输入为 `3W × 3H` 的九宫格 RGBA 图，W、H 为偶数。均匀切分要求源图宽高都能被 6 整除；例如 72×72 源图得到 24×24 瓦片和 12×12 子瓦片。

自定义分割由 `sliceSubTilesCustom` 接受 7 条横向和纵向分割坐标，将不同大小的区域以最近邻采样统一到 `round(width/6) × round(height/6)`。它与均匀切片入口的尺寸约束分开处理。

| 布局 | 网格大小 | 实际瓦片 |
| --- | --- | --- |
| `8x6` | 48 格 | 47 种状态，1 个空位 |
| `11x5` | 55 格 | 47 种状态，8 个空位 |

布局位置由 [layouts.ts](../core/layouts.ts) 固定，状态由 [peerings.ts](../core/peerings.ts) 定义。

## 切片与内角

[slicer.ts](../core/subtile/slicer.ts) 将源图保留为 6×6 的 36 个子瓦片，并从四个外角各生成一个旋转 180° 的内角。旋转改变像素位置，不反转透明度或地形面积。

```text
外角 TL：row0,col0 → 内角 TL
外角 TR：row0,col5 → 内角 TR
外角 BL：row5,col0 → 内角 BL
外角 BR：row5,col5 → 内角 BR
```

`SubTileGrid` 保存 `tiles[36]`、`innerCornerTiles[4]`、子瓦片尺寸与输出瓦片尺寸。每个输出瓦片由 TL/TR/BL/BR 四个象限拼合。保留完整源网格不表示每个子瓦片一定被当前映射引用。

## 连接编码

```ts
// 0 表示相邻地形连接，-1 表示不连接。
type Peering = [T, TR, R, BR, B, BL, L, TL]
// Bitmask：NW=1, N=2, NE=4, W=8, E=16, SW=32, S=64, SE=128
```

对角连接仅在对应两个正交邻居都连接时有效。256 种八邻域组合由此归并为 47 种有效状态。

## 象限映射

两个正交邻居均空时选外角；仅一个连接时选边缘；两个连接而对角为空时选旋转内角。其余情况按另一侧邻接状态选择内部子瓦片，避免大地形块的象限接缝。

下表使用 `(row, col)`，T/R/B/L 为对应方向是否连接；规则按表中条件判断。完整实现见 [mapper.ts](../core/subtile/mapper.ts)。

| 象限 | 两邻均空 | 第一方向空 | 第二方向空 | 两邻连接、对角空 | 内部 |
| --- | --- | --- | --- | --- | --- |
| TL（T、L） | `(0,0)` | `(0,2)` | `(2,0)` | 内角 TL | `(B ? 2 : 4, R ? 2 : 4)` |
| TR（T、R） | `(0,5)` | `(0,3)` | `(2,5)` | 内角 TR | `(B ? 2 : 4, L ? 3 : 1)` |
| BL（B、L） | `(5,0)` | `(5,2)` | `(3,0)` | 内角 BL | `(T ? 3 : 1, R ? 2 : 4)` |
| BR（B、R） | `(5,5)` | `(5,3)` | `(3,5)` | 内角 BR | `(T ? 3 : 1, L ? 3 : 1)` |

内角以 `row === -1` 标识，`col` 为 `innerCornerTiles` 的 0～3 索引。

## 生成流程

1. 可选：将品红背景处理为透明。
2. 按均匀网格或自定义分割提取子瓦片，生成四个旋转内角。
3. 遍历布局中的 47 个条目，读取对应 peering 状态。
4. 为四个象限选择子瓦片，拼接到输出图集的位置。
5. 返回 RGBA 像素、图集宽高和单瓦片尺寸。

从瓦片模块内调用统一入口：

```ts
import { generateTileset } from './core/generator'
import { getLayout } from './core/layouts'

const result = generateTileset({
  mode: 'subtile',
  sourcePixels, // 72×72 的 RGBA 像素
  sourceWidth: 72,
  sourceHeight: 72,
  layout: getLayout('8x6'),
  useMagenta: false,
  magentaTolerance: 30,
})
```

## 验证

在瓦片编辑器中用同一源图切换两种布局，检查边缘、内角、孤岛、L 形、U 形和十字连接。自定义分割还需检查重采样后的接缝。

仓库的 [`tmp-test/index.html`](../../../../tmp-test/index.html) 是独立可视化验证页，通过 HTTP 服务打开。其 JavaScript 镜像不能替代生产 TypeScript 实现；修改算法后仍应检查正式编辑器的输出。
