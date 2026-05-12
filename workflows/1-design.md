# 阶段 1 —— 设计

读取 PRD，为本版本生成测试大纲与测试用例。迭代版本还需产出 PRD diff。

## 预检

1. 读取或初始化 `test/.skill-config.yaml`：
   - 文件不存在 → 用 `templates/.skill-config.yaml` 拷贝生成，逐项与用户确认后写入。
   - 文件存在 → 校验关键字段（`prd_path`、`app_url`、`auth_modes`）非空；缺失则询问后回填。
2. 确认 `test/{version}/` 不与已有产物冲突：
   - 如果该目录已有文件，询问用户：继续 / 重做（删除后重生成）/ 中止。
3. 加载 `role.md` —— 公司层面的统一设计规范，不接受项目级覆盖。
4. 按 `.skill-config.yaml` 的 `prd_path` 完整读完 PRD —— 不要扫读，后续大纲依赖整体把握。若该路径文件不存在，向用户询问正确路径并回写配置。

## 1.0 —— 首版本（没有上一版快照）

### 1.0.a —— 生成测试大纲

输出：`test/{version}/test-outline.md`（参考 `templates/test-outline.md`）。

必备章节：
- 项目概述（一段，从 PRD 提炼）
- 测试范围 / 不在范围（in-scope / out-of-scope）
- 模块清单（每个模块一行：名称 + 一句话职责）
- 风险点（高优先级业务、状态机、资金流转）
- 用例规模预估（按模块 × 类型给一个粗略数量矩阵）
- 设计自评（按 `role.md` 第 10 节，初版可写「待生成用例后补全」）

### 1.0.b —— 生成测试用例

输出：`test/{version}/test-cases.md`（参考 `templates/test-cases.md`）。

- 严格按 `role.md` 的字段、分类比例（功能 55% / 边界 25% / 异常 20%）、覆盖目标生成
- 用例 ID 按模块分组、连续编号
- 对参数数 ≥ 2 的场景使用 Pairwise，组合表附在用例下方
- 不要为没读到的需求脑补用例 —— PRD 没写的，写到「设计自评 / 风险与建议」里指出歧义

### 1.0.c —— 为每个用例生成 meta 占位

为每个用例创建 `test/{version}/{case-id}/meta.json`，schema 见 `conventions/artifacts-layout.md`。本阶段填：
- `id, name, type, module, priority, tags, auth, playwright_strategy`
- `status: "pending"`，时间 / 失败 / 截图字段保留为空。

### 1.0.d —— 快照 PRD

把 PRD 内容原样复制到 `test/{version}/prd-snapshot.md`，加上 YAML frontmatter（`source` 取自 `.skill-config.yaml` 的 `prd_path`）：

```yaml
---
source: docs/产品技术文档.md
captured_at: 2026-05-12T10:00:00+09:00
version: v1.0
sha256: <源文件哈希>
---
```

强制项 —— 下一版本的 diff 依赖它。

## 1.x —— 迭代版本

### 1.x.a —— 与上一版快照做 PRD diff

1. 找到最近的上一版目录（按语义化版本对 `test/v*/` 排序，排除当前版本）。
2. 用当前 PRD 与 `test/{prev}/prd-snapshot.md` 做 diff。采用**章节级**的结构化 diff，不是原始文本 diff —— 仅仅换了说法但语义未变的章节，不应标记为「修改」。
3. 在 `test/{version}/prd-diff.md` 输出四类：
   - 新增需求（列表）
   - 修改需求（列表，含 before/after 摘要）
   - 删除需求（列表）
   - 自身未变但需重新回归的关联点（列表，含原因 —— 例如共用组件发生了变化）

### 1.x.b —— 对已有用例分类

对 `test/{prev}/test-cases.md` 中的每个用例：
- 与 diff 做映射，分类为 `unchanged | modified | new | removed`。
- `unchanged` → 携带过来不动，但 `meta.status` 设为 `"skipped"`，`skip_reason: "unchanged - covered by Playwright regression"`。本版无需重跑，由阶段 4 的 Playwright 回归覆盖。
- `modified` → 携带过来，按需修改步骤 / 预期结果，`status` 重置为 `"pending"`。
- `new` → 从头设计，按 1.0.b。
- `removed` → 不写入本版 `test-cases.md`，在 `prd-diff.md` 中说明。

### 1.x.c —— 写大纲 + 用例 + 快照

参照 1.0.a / 1.0.b / 1.0.d，仅针对变化面进行。大纲应明确总结相对上一版的变化。

## 退出阶段 1 前的校验

按下表逐项检查；任何一项未通过都不能进入阶段 2。

- [ ] `test/{version}/test-outline.md` 存在，且包含「设计自评」章节
- [ ] `test/{version}/test-cases.md` 存在；用例 ID 格式合法；无重复
- [ ] 类型比例在 55/25/20 的 ±5% 范围内（否则重新平衡）
- [ ] 每个用例都有 `meta.json`，且 `playwright_strategy` 已设置
- [ ] `prd-snapshot.md` 存在
- [ ] （迭代版本）`prd-diff.md` 存在；上一版每个用例都已分类

## 向阶段 2 交接

向用户打印：
- 本版用例总数，按模块、按类型的分布
- 待执行（`pending`）与跳过（`skipped` 不变项）的数量
- 在「设计自评」中识别出的 PRD 歧义或设计风险
- 估计执行时长（粗算：chrome-devtools-mcp 每个用例约 2 分钟）
- 询问是否进入阶段 2。
