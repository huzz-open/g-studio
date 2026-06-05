# 04 - 资源管理器 UI 重构

## 概述

资源管理器是 G-Studio 中所有模块访问文件的枢纽。需要从当前的简单文件浏览器升级为具备右键菜单、.gs 感知、模块关联的完整项目管理界面。

## 当前状态（需改造）

- 三栏布局：目录树 / 文件网格 / 预览面板
- 无右键菜单（操作按钮在预览面板中）
- 只识别 sprite-slicer 和 tileset-maker 两个模块
- 通过 .meta 的 openWith 字段决定打开方式
- 无 .gs 文件概念

## 目标状态

- 保持三栏布局（已经好用）
- 新增右键菜单系统
- 以 .gs 为核心资源，智能路由打开逻辑
- 模块通过注册接口声明自己能处理的文件类型
- 文件卡片显示 .gs 摘要信息和引用图片缩略图

## 右键菜单系统

### 技术方案

新建 `src/shared/components/ContextMenu.vue` 组件：

```typescript
interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  separator?: boolean  // 分隔线
  children?: ContextMenuItem[]  // 子菜单
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number }
}
```

### 文件右键菜单项

根据文件类型动态生成：

```typescript
function getFileContextMenu(entry: FsEntry): ContextMenuItem[] {
  const items: ContextMenuItem[] = []

  if (entry.name.endsWith('.gs')) {
    items.push({ id: 'open', label: '打开', icon: 'edit' })
    items.push({ id: 'separator-1', label: '', separator: true })
    items.push({ id: 'show-in-explorer', label: '在文件管理器中显示', icon: 'folder' })
    items.push({ id: 'separator-2', label: '', separator: true })
    items.push({ id: 'rename', label: '重命名', icon: 'pencil' })
    items.push({ id: 'delete', label: '删除', icon: 'trash' })
  } else if (isImageFile(entry.name)) {
    const gsRefs = findGsReferences(entry.path)
    if (gsRefs.length > 0) {
      items.push({ id: 'open-gs', label: '打开关联的编辑器', icon: 'edit' })
      items.push({ id: 'separator-1', label: '', separator: true })
    }
    items.push({ id: 'create-scene-region', label: '新建场景区域', icon: 'map' })
    items.push({ id: 'create-tileset', label: '新建瓦片集', icon: 'grid' })
    items.push({ id: 'create-sprite', label: '新建精灵切分', icon: 'scissors' })
    items.push({ id: 'separator-2', label: '', separator: true })
    items.push({ id: 'rename', label: '重命名', icon: 'pencil' })
    items.push({ id: 'delete', label: '删除', icon: 'trash' })
  } else {
    items.push({ id: 'rename', label: '重命名', icon: 'pencil' })
    items.push({ id: 'move', label: '移动到...', icon: 'move' })
    items.push({ id: 'delete', label: '删除', icon: 'trash' })
  }

  return items
}
```

### 文件夹右键菜单项

```typescript
function getFolderContextMenu(dirPath: string): ContextMenuItem[] {
  return [
    { id: 'new-folder', label: '新建文件夹', icon: 'folder-plus' },
    { id: 'upload', label: '上传文件', icon: 'upload' },
    { id: 'separator', label: '', separator: true },
    { id: 'show-in-explorer', label: '在文件管理器中打开', icon: 'folder' },
    { id: 'separator-2', label: '', separator: true },
    { id: 'delete', label: '删除', icon: 'trash' },
  ]
}
```

## 模块注册接口

### 注册 API

```typescript
// src/shared/module-registry/index.ts

interface ModuleHandler {
  moduleId: string
  gsType: GsType
  label: string
  icon: string
  route: string
  createLabel: string       // "新建场景区域" / "新建瓦片集" 等
  fileSummary: (data: unknown) => string  // 生成摘要文本
}

const handlers: ModuleHandler[] = []

export function registerModuleHandler(handler: ModuleHandler): void {
  handlers.push(handler)
}

export function getHandlerByGsType(type: GsType): ModuleHandler | undefined {
  return handlers.find(h => h.gsType === type)
}

export function getAllHandlers(): ModuleHandler[] {
  return [...handlers]
}
```

### 各模块注册示例

```typescript
// src/modules/scene-region-editor/index.ts
registerModuleHandler({
  moduleId: 'scene-region-editor',
  gsType: GsType.SceneRegion,
  label: '场景区域编辑器',
  icon: 'map',
  route: '/scene-region-editor',
  createLabel: '新建场景区域',
  fileSummary: (data: SceneRegionData) => `${data.regions.length} 个区域`,
})

// src/modules/tileset-maker/index.ts
registerModuleHandler({
  moduleId: 'tileset-maker',
  gsType: GsType.Tileset,
  label: '瓦片集制作器',
  icon: 'grid',
  route: '/tileset-maker',
  createLabel: '新建瓦片集',
  fileSummary: (data: TilesetData) => `${data.tiles.length} 个瓦片`,
})
```

## 文件打开逻辑

### 双击 .gs 文件

```typescript
async function handleOpenGsFile(entry: FsEntry): Promise<void> {
  const content = await readTextFile(entry.handle)
  const gs = JSON.parse(content)
  const handler = getHandlerByGsType(gs.type)
  if (!handler) {
    showToast({ type: 'error', message: `不支持的 .gs 类型: ${gs.type}` })
    return
  }
  router.push({ path: handler.route, query: { gs: entry.path } })
}
```

### 双击图片文件

```typescript
async function handleOpenImage(entry: FsEntry): Promise<void> {
  const refs = findGsReferences(entry.path)

  if (refs.length === 0) {
    // 无关联 .gs → 提供创建选项
    showCreateOptions(entry)
    return
  }

  if (refs.length === 1) {
    // 唯一关联 → 直接打开
    await handleOpenGsFile(refs[0])
    return
  }

  // 多个关联 → 让用户选择
  const chosen = await showChooseDialog(refs)
  if (chosen) {
    await handleOpenGsFile(chosen)
  }
}
```

### "新建场景区域"流程

```typescript
async function createSceneRegionFromImage(imageEntry: FsEntry): Promise<void> {
  const imageName = imageEntry.name.replace(/\.[^.]+$/, '')
  
  // 弹窗确认名称
  const name = await promptInput({
    title: '新建场景区域',
    label: '名称',
    defaultValue: imageName,
  })
  if (!name) return

  // 读取图片尺寸
  const imgSize = await getImageDimensions(imageEntry.handle)

  // 构建 .gs 文件内容
  const gsFile: GsFile = {
    gs: 1,
    type: GsType.SceneRegion,
    gen: `g-studio/${APP_VERSION}`,
    version: 1,
    data: {
      name,
      texture: `./${imageEntry.name}`,
      size: [imgSize.width, imgSize.height],
      y_sort: true,
      regions: [],
    },
  }

  // 写入同目录
  const gsPath = `${getParentPath(imageEntry.path)}/${name}.gs`
  await writeGsFile(gsPath, gsFile)

  // 打开编辑器
  router.push({ path: '/scene-region-editor', query: { gs: gsPath } })
}
```

## .gs 文件卡片渲染

### FileGrid 中的 .gs 卡片

```
┌─────────────────────────┐
│  [场景图标]              │
│  ┌─────────────────┐    │
│  │ 缩略图（引用的   │    │
│  │ texture 图片）   │    │
│  └─────────────────┘    │
│  qingfengzhen           │
│  场景区域 · 3个区域      │
└─────────────────────────┘
```

### 实现要点

- 从 .gs 读取 `data.texture` 路径
- 解析为绝对路径后加载图片作为缩略图
- 从 `type` 获取图标和类型标签
- 从 handler.fileSummary() 获取摘要文本

```typescript
interface GsCardData {
  path: string
  name: string           // 文件名（无扩展名）
  type: GsType
  typeLabel: string      // "场景区域" / "瓦片集" / "精灵切分"
  icon: string           // "map" / "grid" / "scissors"
  summary: string        // "3个区域" / "64个瓦片"
  thumbnailPath: string  // texture 的完整工作区路径
}
```

## 预览面板改造

右侧预览面板在选中 .gs 文件时显示：

1. **缩略图**（引用的 texture 图片）
2. **基本信息**：类型、version、生成工具
3. **数据摘要**：区域数量、图片尺寸等
4. **操作按钮**：
   - "打开编辑"（主按钮）
   - "在文件管理器中显示"
   - "删除"

选中图片文件时：
1. **图片预览**
2. **关联 .gs 列表**（如果有）
3. **操作按钮**：
   - "打开关联编辑器"（如果有唯一关联）
   - "新建场景区域"
   - "新建瓦片集"
   - "新建精灵切分"

## 需要改动的现有文件

| 文件 | 改动 |
|------|------|
| `ResourceManagerView.vue` | 添加 contextmenu 事件处理 |
| `FileGrid.vue` | .gs 卡片特殊渲染 + 右键事件 |
| `DirectoryTree.vue` | 文件夹右键事件 |
| `FilePreview.vue` | 重写为 .gs 感知模式 |
| 新建 `ContextMenu.vue` | 通用右键菜单组件 |
| 新建 `src/shared/module-registry/` | 模块注册系统 |
| 各模块 index.ts | 调用 registerModuleHandler |
