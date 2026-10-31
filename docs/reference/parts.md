# 部件格式与资产

当前部件格式与资产行为。[操作指南](../guides/parts-and-lighting.md) · [文档索引](../README.md)

## 格式与版本

校验入口：[schema.ts](../../src/shared/parts/schema.ts)。`format` 为 `g-studio/part`，支持版本 1 和 2；网格模型要求版本 2。所有部件必须包含 `imageFrame`；旧 `alignment` 数据不再读取或迁移。

| 字段 | 含义 |
| --- | --- |
| `id`、`revision` | 稳定资产 ID 和正整数修订号；名字与精灵序号不是身份 |
| `image` | PNG URI、宽高；内置素材可暂用已知 `builtin:` ID，便携导出嵌入像素 |
| `normal` | 法线生成参数，默认值和归一化见 [normal-settings.ts](../../src/shared/types/normal-settings.ts) |
| `model` | 类型、整体尺寸及类型专属数据 |
| `modelAlternatives` | 可选，最多 32 个曾使用的模型，包含可切换回来的嵌入模型 |
| `modelComparison` | 可选，原生/优化网格、输入指纹与采用状态；见[候选设计](../design/model-comparison.md) |
| `imageFrame` | 固定图片参考矩形：相机平面中的 `left`、`bottom`、`height`，宽度由图片宽高比推导 |
| `source` | 可选来源：原图/裁剪图 SHA256、文件名、裁剪矩形及 `.gs` 路径 |

图像必须是嵌入 PNG 或已知内置素材，不能使用任意远程 URL。宽高各不超过 2048，像素总数不超过 400 万。字段的完整范围以校验器为准。

## 模型类型

| `model.kind` | 数据与限制 |
| --- | --- |
| `none` | 尚未生成模型，只显示图片，不合成算法模型 |
| `mesh` | v2 部件中的嵌入 GLB 及来源元数据 |

图片参考范围在部件创建时确定，与选择的模型、候选版本、朝向和尺寸无关。导入图片以最长边 2 个场景单位初始化；内置素材使用其制作时的参考矩形。自动对齐将模型匹配到该矩形内的有效像素，透明孔洞参与匹配。模型匹配由优化算法处理，图片保持固定。

备用模型最多保存 32 个，仅当前采用模型参与场景渲染。

网格类型的 `PartModel` 可携带 `imageFit`、`repair` 及 `frozen`/`original` 等模型处理状态。当前实际采用的 `model` 与比较候选分开保存；开启优化后，计算完成会自动采用；关闭使用原生版本。

网格字段由 [mesh.ts](../../src/shared/parts/mesh.ts) 定义：

```ts
// 核心字段节选；完整类型见 mesh.ts。
interface MeshModel {
  uri: string;              // data:model/gltf-binary;base64,...
  sha256: string;
  providerId: string;
  inputSha256: string;
  warnings: string[];
  providerVersion?: string;
  modelId?: string;
  modelRevision?: number;
  generation?: {
    seed?: number;
    targetFaces?: number;
    parameters: Record<string, number>;
  };
}
```

导入器接受自包含 GLB 三角网格，最多 40,000 面；不接受外部资源、蒙皮或动画。传输限制与客户端限制不同，见[生成协议](../../packages/generation-protocol/README.md)。

## 资产、实例与草稿

资产库存于 IndexedDB `g-studio-parts-v1`；数据库名不代表只支持部件 v1。保存通过读写事务检查修订号，较新的资产不被旧精灵图快照覆盖。

场景实例包含 `id, assetId, x, z, scale, visible, casts, receives`，每个场景最多 24 个实例。重复添加资产创建新实例，保存资产会更新所有引用，但不改实例位置和阴影开关。

编辑器在保存前使用草稿。精灵切分自动入库时，以裁剪 PNG 内容的 SHA256 和宽高生成稳定资产 ID；相同裁剪内容跨原图、文件名和位置复用资产。并发入库通过 IndexedDB 事务复用已有版本，不覆盖已编辑的名称、法线或模型。裁剪内容或尺寸变化创建新资产，既有场景继续使用旧引用。来源图哈希和裁剪位置仅保留为首次入库的来源记录。

## 持久化与导出

- 场景便携导出使用版本 2 的 `g-studio/scene`，含实例和去重后的资产。浏览器标签页存储有独立版本，不与导出格式混用。
- 导入遇到相同 ID、不同内容的资产时，克隆并重映射引用。
- `.gs` 精灵可包含完整 `partAsset` 快照；旧文件缺少该字段仍有效。法线设置继续镜像以兼容原导出。
- 法线、前表面深度等缓存由图像和参数重新生成，不作为独立可编辑事实保存。
- 已保存的 AI 网格随部件保留，加载场景不需要生成服务在线。

验证命令与人工检查见[开发指南](../../CONTRIBUTING.md#验证改动)。
