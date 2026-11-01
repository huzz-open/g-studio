# G-Studio Godot 2D runtime

通用源码由 GS 维护在 `packages/godot/addons/gstudio_2d`，安装到目标工程的 `addons/gstudio_2d`。资产生成、配准和导出由 `services/godot/service.mjs` 统一调用。GS 的 Godot 面板和 MCP 使用这个相同服务，清风镇不再是运行时依赖。

## 使用

1. 在 GS 顶栏打开 **Godot**，输入包含 `project.godot` 的本地工程目录并连接。
2. 安装运行时，登记工程中的彩色 PNG 和同尺寸法线 PNG。
3. 需要模型时点击生成；也可以通过 MCP 提交生成任务并查询状态。
4. 点击“准备 GS 模型”，在“预览快照”中检查 GS 前端实际绘制的模型及哈希。部件编辑器也可以用“同步当前模型到 Godot”保存当前采用的模型。导出只读取这份快照，不再重新配准。
5. 导出后，Godot 自动导入 `assets/gstudio/<id>/<id>.tscn`，直接实例化即可。用户地图和实例摆放不由导出器重写。
6. 添加 `addons/gstudio_2d/point_light.tscn`。它可以独立放置，也可以挂到任何玩家/火把的动画挂点下面。不依赖名为 Player 的节点。
7. 地面使用 `ground.tscn`（GSGround2D），可修改 Polygon2D 的范围、颜色和纹理。普通未接入组件的 Sprite2D/TileMap 不会自动获得 GS 表面光照。

GSWorld2D 在运行时按 Viewport 自动创建一份；也可预先放置 `world.tscn` 配置环境亮度、像素比例与观察角度。同一个 Viewport 只能有一个管理器。默认 100 像素/单位、20° 俯视，导出时必须使用相同投影参数。

播放器运行、碰撞和地图编辑仍然是二维。隐藏的三维世界只参与光照/阴影，导出后的游戏不需要 GS、MCP、Python 或模型服务运行。

## 组件职责

- `GSAsset2D`：原图、法线图、表面网格、完整阴影代理，以及二维地面碰撞。每个实例持有独立 ShaderMaterial；共享静态 Mesh/Texture 资源。
- `GSPointLight2D`：独立 Marker2D 发光组件，提供位置、颜色、强度、物理高度、照明范围、阴影开关与可选闪烁。它不运行额外的原生二维灯光，避免重复照明。
- `GSGround2D`：二维地面接收面，使用共享照明图。
- `GSWorld2D`：共享 World3D/SubViewport、所有灯与对象的注册/清理、坐标转换和总照明输出。

光照使用 Godot 的真实三维光源及阴影贴图。所有光源在同一个离屏场景中计算，总照明再应用到二维图片，不通过叠加黑色阴影层压暗其他光源。

阴影直接使用 GS 最终三角形与几何法线，作为 PackedVector3Array 写入资源，绕过 OBJ 导入转换。二维原图保持原样。受光着色器通过 LIGHT_VERTEX 读取从同一份快照烘焙的真实三维表面位置，并使用几何法线与冻结的法线图；显示平面只决定像素覆盖和二维排序，不冒充真实受光表面。字段使用 RGBAF 浮点纹理，模型、表面字段与资产组件必须持有同一快照哈希。

## 导出文件

`color.png`（裁紧后的导出图）、`normal.png`、`surface_mask.png`、`render_mesh.tres`（原始三角形/法线/参考 UV）、`surface_fields.tres`（真实三维表面位置/法线/有效性）、`shadow.tscn`、`<id>.tscn` 和 `export.json`。

导出格式为 `gs-godot-snapshot-1`，不读取旧配准导出。`export.json` 保存几何 SHA-256、快照 SHA-256 和正反坐标变换矩阵。运行时从数组创建 ArrayMesh，关闭网格压缩，不经过 OBJ 的 LOD/阴影网格生成。旧 OBJ 和像素平面表面文件在重新导出时移除。

原始生成网格保存在工程 `.g-studio/models`，防止生成服务清理历史任务后无法重导出。元数据保存源哈希、配准、接地锚点、碰撞轮廓及模型对原图的表面覆盖率。

生成网格的最低点可能只是细小突出点，所以地面碰撞采用高度 2%～12% 的多个近地截面并集，再投影成二维占据区域。独立支撑和孔洞不合并成凸包；简单轮廓导出多边形，带孔区域用等价的矩形分解表达。它是近地阻挡近似，不是严格的单一零高度截面。

导出写入 `.g-studio/export-staging`，完成后再发布到生成目录；上一版留在 `.g-studio/export-backups`。同一资产有跨进程导出锁。用户应把自己的行为脚本和修改放在外层/继承场景，不直接编辑生成的 `.tscn`。

## MCP 和本地服务

```text
npm run mcp:godot
```

这是标准 stdio MCP 服务，连接配置使用 `node` 和该仓库 `services/godot/mcp.mjs` 的绝对路径，不需要额外 MCP SDK。

工具：`gs_bind_project`、`gs_list_assets`、`gs_register_asset`、`gs_generate_model`、`gs_generation_status`、`gs_install_runtime`、`gs_prepare_asset`、`gs_preview_asset`、`gs_set_render_snapshot`、`gs_export_asset`、`gs_job_status`、`gs_cancel_export`。

生成和导出返回任务标识，分别查询状态；MCP 不把后台任务创建当成任务完成。模型生成使用现有本地模型服务，凭证只在服务端读取，不通过工具结果或浏览器返回。

导出端需要 Node 项目依赖及带 Pillow 的 Python；可用 `GS_PYTHON` 指定解释器。本机模型服务默认使用 8765 端口。Godot 游戏端没有这些依赖。

本地 GS 界面：开发模式 `npm run dev:web`；构建后 `npm run godot:serve`，访问 `http://127.0.0.1:8766`。API 只接受本机连接及同源浏览器请求。纯静态网页托管模式不能直接运行本地生成/导出后端。

## 已验证与边界

- 清风镇七个物件迁移完成；除已生成的桶外，其余六张实际原图都调用模型服务生成。失败任务重试更换生成配置，没有改用手工代理。
- 空白 Godot 工程仅复制 addon 和一个桶资产即可运行。两盏独立灯的照明叠加、模型遮挡开关、对象移动、删除注册对象均经过 Forward+ GPU 测试。
- 清风镇七个资产均有自动二维碰撞和表面网格，玩家碰撞扫掠通过。
- GS 构建后的浏览器面板实际完成过绑定、列举七个资产与导出；MCP 协议及工具错误响应有自动测试。

目前针对固定视角的静态物件；支持平移和等比缩放。二维旋转、跨视图重挂载、任意动态网格/逐帧角色深度不在本轮验收范围。动画玩家可携带标准灯，但没有自动获得逐帧生成的三维表面。

原图没有被模型覆盖的部分不再补假定的三维位置，只显示环境底色照明；sourceImageCoverage 记录真实覆盖率。生成网格本身的缺失仍需修正，不能用导出一致性代替重建质量。原图内已有的明暗也不会自动被移除。渲染依赖 Godot 光照模型，不承诺和 GS WebGL 渲染逐像素相同。当前验证环境为 Godot 4.7.2 Forward+ / D3D12。

网格一致性验证：运行 `tests/godot/test_snapshot_import.gd` 回读 Godot 的渲染顶点/索引数组，再运行 `python scripts/registration/audit-godot-snapshot.py <Godot项目根目录>`。七个当前资产反变换最大位置误差低于 2×10⁻⁷ 个 GS 单位。该验证不代表原始生成模型本身已正确重建。

静态素材在 GS 导出时按 alpha >= 21/255 计算有效像素边界并裁紧 PNG。颜色图、法线图、遮罩、表面字段使用同一裁切范围，同时重算参考 UV 和图片锚点；几何、碰撞、像素比例不变。export.json 的 textureCrop 记录原图裁切框，源素材保留用于编辑和重导出。Godot 的静态 Sprite3D 使用完整导出图，不再扫描透明边距或启用 region 裁切。动画 SubViewport 仍使用逐帧区域，避免改变动画画布和挂点。
