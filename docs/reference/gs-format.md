# 当前 .gs 工程格式

当前读写格式；历史方案另见文末。[文档索引](../README.md) · [部件格式](parts.md)

## 格式入口

| 源码 | 职责 |
| --- | --- |
| [types.ts](../../src/shared/gs-format/types.ts) | 当前字段与类型 |
| [schema.ts](../../src/shared/gs-format/schema.ts) | 读取时校验 |
| [reader.ts](../../src/shared/gs-format/reader.ts) | 从工作区解析工程 |
| [writer.ts](../../src/shared/gs-format/writer.ts) | 写入、版本递增与冲突检查 |

```ts
interface GsFile<T> {
  gs: 1;           // 格式版本
  type: GsType;    // 业务类型
  gen: string;     // 写入工具，例如 g-studio/<版本>
  version: number; // 文件修订号
  data: T;
}
```

`version` 与格式版本不同：新文件从 1 开始，每次写入递增。调用者提供 `lastKnownVersion` 时，磁盘版本较新会返回冲突；强制覆盖有独立入口。

## 业务类型

| type | 数据 | 当前情况 |
| --- | --- | --- |
| 1 SceneRegion | 背景图、尺寸、区域与 Y 排序 | 已有读写和校验；区域 groups 为字符串数组 |
| 2 Tileset | 图片、sdf/subtile 模式、布局及参数 | 已有读写和校验 |
| 3 Sprite | 图片、切图配置与精灵条目 | 已有读写和校验；条目可含法线设置和完整 partAsset |
| 4 WorldMap | 类型常量 | 尚无对应页面路由，不作为已交付编辑器列出 |

顶层图片通常通过路径引用；精灵条目的 `partAsset` 可包含嵌入图片及 v2 网格，因此不能把所有 `.gs` 概括为“永不包含二进制内容”。完整字段和约束以源码为准。

## 与其他格式的关系

`.gs` 工程、`g-studio/part` 部件和 `g-studio/scene` 场景导出是不同格式，版本号各自演进。后两者的存储与导出见[部件参考](parts.md)。

[引擎桥接原始方案](../design/engine-bridge/README.md) 中的枚举、示例和同步计划保留用于理解设计，不能直接替代当前类型，也不表示 Godot 双向同步插件已经验收。
