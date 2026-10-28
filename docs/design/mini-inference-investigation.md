# Mini Turbo 推理异常与性能调查

状态：**未解决，作为下一轮优先修复项**。记录日期：2026-10-28；实现与证据基线：`ee280646f5af2e65b2cb26e350810334f9a9a269`。本次仅整理问题和调查要求，没有新增推理实测，也没有修改运行策略。

Mini 的速度和几何退化不能作为正常模型表现接受。目标是恢复与固定上游实现相符的几何及性能，并在容量允许时常驻复用。当前“FP32 编码 + 分阶段执行”只是一条已经恢复物体体积的临时适配路径，不能据此关闭问题。

## 1. 已确认的现象与需要纠正的结论

环境为 Apple M5、24 GiB 统一内存、macOS 26.5.2、Python 3.12.12、PyTorch 2.6.0。完整测试参数和产物见 [2026-10-28 验证记录](../history/model-generation-upgrade-20261028.md)及其 [JSON](../history/model-generation-upgrade-20261028.json)。

| 证据 | 可以确认 | 不能由此推出 |
| --- | --- | --- |
| Mini/MPS 全 FP16 路径在花瓶、椅子、纸伞、盆景上生成平板/方块；HTTP 与 GLB 校验仍成功 | 存在严重的重建退化，有限值和有效文件不等于正确几何 | Mini 正常就只能生成板子，或单图歧义足以解释该退化 |
| 输入正常，condition/latent 均有限；花瓶 FP16 condition 与旧 FP32 基线 RMS 差约 1.808、余弦约 0.211 | 编码结果已出现显著偏离，值得从编码路径定位 | 某个具体 MPS 算子已被证明有错，或全部差异仅来自硬件 |
| 完整编码器改为 FP32 后与旧基线 RMS 差为 0；后续 FP16 采样/解码恢复花瓶体积 | 固定 FP32 编码是当前组合的有效规避办法；修复后四类素材恢复可识别形状 | 官方要求 Mini 编码器必须 FP32，或 FP16 的根因已修复 |
| 仅改 VAE、仅改采样或仅提升 DINO 注意力计算精度，没有恢复该花瓶 | 这些单项改动没有解决已复现问题 | 编码器内其他运算、位置编码、加载或适配差异已经排除 |
| 修复后 Mini 分阶段花瓶首次/连续执行为 36.20/37.43 秒；标准 Turbo 常驻为 31.89/20.24 秒 | 当前实现未体现预期的 Mini 速度优势，需要解释耗时组成 | 不同精度、不同生命周期的数字能直接代表两个模型的速度排序 |
| 当前策略算出 Mini 常驻预算 15.94 GiB，某次启动预算 15.93 GiB，因而选 staged | 程序遵循了当前估算规则 | 15.94 GiB 是官方最低内存，或 24 GiB Mac 已实测无法常驻 Mini |

同一花瓶的四视图证据（上排原始、下排减面）：[全 FP16 平板退化](../history/assets/model-generation-upgrade-20261028/mini-fp16-regression-vase.png)与 [FP32 编码规避后的结果](../history/assets/model-generation-upgrade-20261028/mini-vase.png)。二者均为此前本轮实测产物，本次只归档失败截图。

**纠正此前解释：Mac/MPS 并非原则上不能常驻或使用 FlashVDM；CUDA 也尚未实测通过本轮改造。** 本轮没有完成修复后 Mini 的真实常驻容量校准。保守阈值作出的拒绝不能作为硬件能力的实验证明。

Mini 的平板/方块退化与仍然存在的瓶口封闭、雕花误穿孔分开跟踪；完整 2.1 的盆景扁平化也保留在总方案中，不能据 Mini 的局部定位认定它们具有相同根因。

## 2. 上游 FlashVDM 如何运行

FlashVDM 的加速包括蒸馏后的少步采样和快速 VAE 解码。官方示例选择 Turbo 模型、调用 `enable_flashvdm()` 并使用约 5 步；仓库展示的约一秒结果针对 RTX 4090，不能直接转换为 MPS 的性能承诺。[FlashVDM 官方说明](https://github.com/Tencent-Hunyuan/FlashVDM)

以下源码比较固定在项目采用的 Hunyuan3D-2 revision `f8db63096c8282cb27354314d896feba5ba6ff8a`，不以浮动主分支替代资源锁定。

| 项目 | 固定上游实现 | 当前项目差异及调查点 |
| --- | --- | --- |
| 生命周期 | 创建 Pipeline，保存 conditioner、DiT、VAE；Gradio 启动时创建形状 worker，请求复用它 | resident 路径复用；staged 路径每任务依次创建 encode/sample/mesh 子进程并重新加载模块，中间张量落盘 |
| 精度 | Pipeline 默认 CUDA/FP16，并将组件转到指定设备/精度 | Mini/MPS 编码器固定 FP32；输入预处理固定 CPU FP32；这些是本项目适配，需要独立验证 |
| FlashVDM | 按模型映射替换配套 Turbo VAE，再启用解码器及自适应 KV 筛选 | 直接加载已锁定的 Turbo VAE 并启用对应解码器；需对照实际组件，而非只看开关名称 |
| 内存管理 | Pipeline 提供 Accelerate 的组件级 CPU offload，保留对象并按执行顺序迁移 | 当前 staged 通过退出进程释放资源，后续重新读取权重；两种方式开销不同 |
| 解码参数 | `enable_flashvdm()` 默认 `topk_mode='mean'`；Gradio 生成入口 `num_chunks=200000` | 当前使用 `merge`、`num_chunks=2048`；它们是否影响速度/几何需要单变量对照，不能直接照抄大块大小 |
| 容量决策 | 这里核对的上游代码没有项目这套固定工作区门槛 | 项目给 MPS/FP32 编码器预留 9 GiB 工作区，另加权重、加载和系统余量；尚未按修复后常驻实测校准 |

源码依据：[Pipeline 加载、FlashVDM 与 offload](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/f8db63096c8282cb27354314d896feba5ba6ff8a/hy3dgen/shapegen/pipelines.py)、[Gradio 生命周期与参数](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/f8db63096c8282cb27354314d896feba5ba6ff8a/gradio_app.py)。Pipeline 提供 offload 方法不代表该版本 Gradio 的形状路径已启用它；也不代表它在 MPS 上已通过验证。

## 3. 下一轮调查顺序

### A. 先建立可比较的正确性基线

1. 复用已校验的 Mini、Mini Turbo VAE、配置和固定源码，记录所有依赖版本；不重新下载正确缓存，不混用标准版 VAE。
2. 用固定上游加载/调用路径建立独立对照，与项目适配路径运行同一批输入。记录必要的 MPS 兼容修改；遇到不支持的算子直接记录失败，不能悄悄换设备。旧 FP32 基线属于项目历史路径，不能冒充未经修改的官方基线。
3. 控制输入、背景处理、mask、图像尺寸、步数、guidance、512 latent token、VAE 缩放、查询网格和提面算法。比较精度时保存并复用同一初始噪声；仅固定 seed 不保证不同 dtype/backend 抽到相同噪声。
4. 先比较预处理张量、patch/位置编码和逐层编码输出，找到首个明显偏离位置；再比较 condition、每步 latent、VAE 特征和查询 logits。记录 dtype、设备、形状、有限值、误差和必要的统计，避免只比较最终图片。
5. 对常规权重加载与当前 meta/assign 加载、预处理、位置编码插值、归一化/MLP/注意力等逐项做受控比较。它们均是待排查项，当前没有已确认的具体算子根因。必要时在隔离环境单独对照依赖版本，不能直接升级生产锁定环境来掩盖原因。

### B. 拆分耗时，再校准常驻容量

1. 分别计时进程/导入、读取与搬运权重、编码、采样、VAE/提面、减面、磁盘 I/O 和排队；GPU 段同步后计时。区分下载/校验、加载、预热、首次任务和连续任务。
2. 在相同几何质量和参数下比较上游路径、项目常驻与项目分阶段；扫描安全的解码块大小，单独对照 `mean/merge`。不能靠降为 1 步、降低分辨率或更换素材来声称问题解决。
3. 先只启用 Mini，测加载峰值、常驻空闲占用、预热、四类任务峰值及连续任务后的保留缓存，再做多模型合计预算。当前张量、driver、RSS、系统可用量分别记录，不能重复相加，也不能把 driver 减去权重就当成可泛化工作区。
4. 将持久权重、每实例保留缓存、当前活动阶段临时占用、加载峰值及安全余量分开建模。在隔离、可停止的验证进程内收集证据后修订门槛；不得仅为“让它常驻”随意压低预留或关闭设备分配限制。
5. 若只能采用低内存策略，评估保持对象与权重缓存的复用方式，量化与每任务重启三进程的差异。任何组件卸载策略都需在启动时明示，保留设备、精度和执行策略固定的约束，不做错误触发的 CPU 推理回退。

### C. CUDA 单独验收

当前 CUDA 路径默认编码/采样/解码 FP16，不应用 Mini/MPS 的编码 FP32 特例；FlashVDM 已接入，但真实 CUDA 的速度、质量与容量尚未验证。记录 GPU 型号、显存、驱动、PyTorch/CUDA 版本，先确认当前 PyTorch 2.6/CUDA 12.4 与显卡架构兼容。先运行单 Mini，再测标准 Turbo 与多模型集合；不得用 CUDA 的通过结果替代 MPS 验收，反之亦然。

## 4. 关闭问题的标准

- [ ] 给出“板子”退化的可复现原因及最小回归，明确是适配、算子、版本还是其他因素；FP32 规避办法不能自动等同根因修复。
- [ ] 固定同一批四类素材，原始与减面网格均保留合理体积，不再出现本轮普遍的平板/方块退化；保留四视图、参数与产物 hash。合法 GLB、有限值或面数合规均不能单独判定通过。
- [ ] 在目标硬件上完成单 Mini 的首次与至少五次连续任务（覆盖四类素材及同图重复）；常驻时 instanceId 不变、loadCount=1，不重复读权重。若确实放不下，提交实测峰值与余量依据，不能只引用当前门槛。
- [ ] 给出同硬件、同参数、同质量的上游/项目耗时分解，解释并消除由重复加载、进程重建、I/O 或不合理块大小引入的可避免开销。具体延迟目标以该基线制定，不承诺跨硬件“一秒”，也不把当前约 36–45 秒直接定为合格线。
- [ ] 加载期间提交/查询/取消、取消后同实例再次生成、OOM/无效输出、退出/重启及多模型预算回归仍通过；不引入首次任务后自动调策略。
- [ ] MPS、CUDA 分别记录通过/失败/未验证，更新总方案和验证记录；未实测的平台保留未验证状态。范围仍限于几何，不借机扩展纹理、PBR、Small 或新后端。

## 5. 实施入口与现有证据

- [数值与加载适配](../../services/generation-python/runtime.py)、[模型与编码精度规则](../../services/generation-python/model_catalog.py)、[预算](../../services/generation-python/policy.py)。
- [常驻工作进程](../../services/generation-python/resident.py)、[分阶段入口](../../services/generation-python/phase.py)、[任务与减面](../../services/generation-python/generate.py)。
- [真实任务对照脚本](../../tests/generation_benchmark.py)、[网格统计](../../tests/generation_mesh_report.py)、[适配器回归](../../tests/generation_adapter_test.py)。
- 本机忽略目录 `output/generation-upgrade-20261028/`：`mini-final/` 是全 FP16 失败几何，`mini-corrected/` 是 FP32 编码规避后的对照；`probe-mini.log`、`probe-sample.log`、`probe-encoder.log`、`probe-attention.log` 保留单项探查。它们是历史证据，不是下一轮验收结果。

后续实施先检查工作区和远端，保留已有改动；以总方案的固定资源与本问题单的受控对照为依据。问题未关闭之前，描述应为“服务能力已接入，Mini 正确性根因与性能仍待解决”。
