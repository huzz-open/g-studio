# 05 - 工作区绑定策略

## 概述

G-Studio 工作区绑定到 Godot 项目根目录，使资源管理器直接管理整个游戏项目的文件结构。用户按 Godot 惯例组织资源，G-Studio 不强制自己的目录结构。

## 绑定流程

### 用户操作

1. 用户点击"打开工作区"
2. 系统弹出文件夹选择器（File System Access API `showDirectoryPicker`）
3. G-Studio 检查选中目录

### 检测逻辑

```typescript
async function openWorkspace(handle: FileSystemDirectoryHandle): Promise<void> {
  // 检查是否为 Godot 项目
  const isGodotProject = await fileExists(handle, 'project.godot')

  if (isGodotProject) {
    await initGodotProjectMode(handle)
  } else {
    await initGenericMode(handle)
  }
}

async function initGodotProjectMode(handle: FileSystemDirectoryHandle): Promise<void> {
  // 1. 创建 .g-studio 系统目录
  const sysDir = await handle.getDirectoryHandle('.g-studio', { create: true })

  // 2. 写入 .gdignore（让 Godot 忽略此目录）
  await writeFile(sysDir, '.gdignore', '')

  // 3. 写入 config
  await writeFile(sysDir, 'config.json', JSON.stringify({
    mode: 'godot-project',
    createdAt: Date.now(),
  }))

  // 4. 不创建任何预设子目录
}
```

### 模式区别

| 行为 | Godot 项目模式 | 普通模式 |
|------|---------------|---------|
| 系统目录 | `.g-studio/` + `.gdignore` | `.g-studio/` |
| 预设子目录 | 不创建 | 不创建（废弃旧行为） |
| 打包排除提示 | 不需要（.gdignore 生效） | 不适用 |
| .gs 文件扫描 | 全项目递归 | 全目录递归 |

## 目录结构约定

G-Studio **不强制**目录结构。以下是推荐结构（符合 Godot 社区惯例）：

```
MyGodotProject/
├── project.godot
├── addons/
│   └── g_studio/            ← G-Studio 引擎插件
├── .g-studio/               ← G-Studio 系统文件（Godot 忽略）
│   ├── .gdignore
│   └── config.json
├── assets/                  ← 游戏资源
│   ├── scenes/
│   │   ├── town.gs         ← 场景区域数据
│   │   ├── town.tscn       ← 引擎场景（插件生成/维护）
│   │   └── town.png        ← 背景图
│   ├── tilesets/
│   │   ├── grass.gs
│   │   ├── grass.tscn
│   │   └── grass.png
│   └── sprites/
│       ├── hero.gs
│       └── hero.png
├── scenes/                  ← 游戏逻辑场景
│   └── main.tscn
└── scripts/                 ← GDScript
```

用户完全可以用其他结构，只要 .gs 文件和它引用的图片之间的相对路径正确即可。

## .g-studio/ 系统目录

### 内容

```
.g-studio/
├── .gdignore          ← 空文件，让 Godot 完全忽略此目录
└── config.json        ← 工作区配置
```

### config.json 结构

```typescript
interface WorkspaceConfig {
  mode: 'godot-project' | 'generic'
  createdAt: number
  gStudioVersion: string
}
```

### 不再需要的内容

- ~~uid-index.json~~ → 废弃（.meta 系统废弃）
- ~~预设目录列表~~ → 废弃

## 打包排除策略

### .g-studio/ 目录

通过 `.gdignore` 文件自动排除。Godot 的 EditorFileSystem 和导出系统都会忽略含有 `.gdignore` 的目录。

### .gs 文件

.gs 文件分布在项目各处（与 .tscn 并列），需要通过 export filter 排除。

方式：Godot 的 export_presets.cfg 中添加：
```ini
exclude_filter="*.gs"
```

这可以由 G-Studio Godot 插件在 `_enable_plugin()` 时自动配置，也可以在文档中指导用户手动配置。

### 自动配置脚本（插件侧）

```gdscript
func _enable_plugin():
    # 检查 export_presets.cfg 是否已有 *.gs 排除
    var presets_path = "res://export_presets.cfg"
    if FileAccess.file_exists(presets_path):
        var content = FileAccess.get_file_as_string(presets_path)
        if "*.gs" not in content:
            push_warning("[G-Studio] 建议在导出预设中添加排除 filter: *.gs")
    # 注意：不自动修改用户的导出配置，只给出提示
```

## 无工作区行为

当用户未绑定任何工作区时：

| 操作 | 行为 |
|------|------|
| Ctrl+S | 不可用（按钮灰色，快捷键无响应） |
| 导出 | 可用（下载 .gs / .tscn / zip） |
| 打开文件 | 可用（通过拖入或文件选择器，临时加载到内存） |
| 资源管理器 | 显示"请打开工作区"引导页面 |
| 新建 | 可用（在内存中创建，Tab 标记为"未保存"） |

### 引导绑定

当用户尝试 Ctrl+S 但无工作区时：

```typescript
function handleSave(): void {
  if (!isWorkspaceOpen()) {
    showToast({
      type: 'info',
      message: '请先打开工作区以启用保存功能',
      action: { label: '打开工作区', onClick: openWorkspace },
    })
    return
  }
  // ... 正常保存逻辑
}
```

## 工作区切换

支持在不同工作区之间切换：
- 切换前：检查所有 Tab 是否有未保存修改 → 提示保存
- 切换后：重新扫描新工作区的 .gs 文件 → 关闭所有已打开的 Tab

## 从旧工作区迁移

如果打开的工作区有旧版 G-Studio 的痕迹（存在预设子目录和 .meta 文件）：
- 不自动删除旧文件
- 正常工作（向后兼容）
- 当用户将模块适配到 .gs 格式后，旧 .meta 自然废弃
