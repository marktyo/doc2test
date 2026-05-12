# 阶段 2 —— 执行

通过 chrome-devtools-mcp 驱动真实浏览器，逐个执行 `pending` 用例并收集证据。

## 预检

1. 确认 `chrome-devtools-mcp` 可用，不可用则告知用户如何启用并中止。
2. 从 `test/.skill-config.yaml` 读取 `app_url` 与 `auth_modes`。
3. 用 `mcp__chrome-devtools__navigate_page` 访问 `app_url`，确认 HTTP 200。不通则要求用户启动应用。
4. 加载 `test/accounts.md` 中的测试账号。若文件不存在或缺少某 `auth` 角色的凭据 → 向用户询问后写入（首次写入时同步把 `test/accounts.md` 加入 `.gitignore`，若 `.gitignore` 已存在该规则则跳过）。
5. 用 `mcp__chrome-devtools__new_page` 打开一个全新页面，记录 `pageIdx`。

## 登录态策略（默认）

依据用例 meta 的 `auth` 字段：

| `auth` 取值 | 行为 |
|---|---|
| `none`（保留字）| 不登录，以匿名身份访问应用入口。 |
| `fresh`（保留字）| 每个用例独立的 incognito context。登录 / 注册类用例必须使用，需要干净状态。 |
| 任何 `.skill-config.yaml` 中 `auth_modes` 定义的角色 key | 整次 run 内复用该角色的同一个会话：首次按 `login_url` + `test/accounts.md` 中的凭据登录一次，后续同角色用例复用 cookie。 |

会话复用：首次登录后通过 `evaluate_script` 导出 document.cookie + localStorage 快照，后续同角色用例执行前再注入回去。

为方便阶段 3 提炼 Playwright，同时保存一份 Playwright 兼容的 `storageState.json`，按角色落到 `test/playwright/fixtures/auth-{role}.json` —— 阶段 3 的脚本可直接跳过登录流程。

## 执行循环

对每个 `meta.status === "pending"` 的用例：

### 2.a —— 准备

- 更新 `meta.status = "running"`，`started_at` 取当前时间。
- 按 `auth` 模式切换到 / 创建对应页面。
- 切换 tab 后必须先 `mcp__chrome-devtools__bringToFront` 再交互。
- 跳转到用例「前置条件」隐含的起始 URL。

### 2.b —— 执行步骤

逐行读用例的「步骤描述」。对每个步骤：

1. 决定对应的 chrome-devtools-mcp 动作：
   - 点击 → 先 `take_snapshot` 拿到 element ref，再 `click`
   - 输入 → `fill` 或 `type_text`
   - 等待 → `wait_for`，使用可见文本或 URL 条件，不要用固定 sleep
   - 下拉选择 → `fill_form` 或 `click` + `click`
   - 滚动到目标 → 长页面操作前先把目标滚入视野
2. 在关键节点截图（不必每步都截）：
   - 首次交互前
   - 每次状态切换后（表单提交、状态变更、跳转）
   - 任何意外弹窗 / 错误
   - 失败时必截
   - 文件名：`{NN}-{slug}.png`，落到 `test/{version}/{case-id}/screenshots/`。
3. 每步执行后调用 `list_console_messages` 采集 console，将新增条目附加到 `console.log`（带时间戳）。
4. 出现页面未捕获错误或意外弹窗（必要时先 `mcp__chrome-devtools__handle_dialog`）：截图、记 console.log、为该步标记失败。

### 2.c —— 校验预期结果

对每个预期结果：
- 可由 DOM / 文本验证 → `take_snapshot` 后核对元素与文本。
- 可由 URL 验证 → 检查当前 URL。
- 可由网络响应验证 → `list_network_requests` 后检查。
- 主观判断（UX、布局、文案）→ 截图后由 LLM 基于截图判断，结论写进 `steps.md`。

### 2.d —— 记录结果

写 `test/{version}/{case-id}/steps.md`（下方为通用电商示例）：

```markdown
# {case-id} —— {用例名称}

**状态：** passed | failed | blocked
**用时：** 78s
**登录态：** customer

## 步骤日志

1. ✅ 跳转 /cart — 截图：`01-cart.png`
2. ✅ 点击「去结算」
3. ✅ 选择支付方式：信用卡
4. ❌ 预期：跳转 /orders 并显示「订单已提交」toast
   - 实际：停在 /checkout，无 toast
   - 截图：`04-after-submit.png`

## 主观检查

- 提示文案清晰度：PASS —— 「订单已提交」与 PRD 措辞一致。

## Console 问题

（见 console.log）
```

更新 `meta.json`：
- `status`（最终）、`finished_at`、`duration_ms`
- `screenshots`（文件名列表）
- `failure`（status=failed 时），记录第一个失败的步骤
- `playwright_test_name` 留空 —— 阶段 3 提炼时回填

### 2.e —— 为下一个用例恢复环境

- 浏览器进入异常状态（未捕获错误、卡住的弹窗）→ 关闭当前页面、开新页面。
- 刚跑完一个 `fresh` 用例 → 销毁其 context。

## 进度反馈

- 用例数较多时（> 30）按模块在 `TodoWrite` 中分组，少时每个用例一条。
- 每 10 个用例或跨模块时向用户打印简要进度：`[12/47] 模块=Order，passed=11，failed=1`。

## 提前停止条件

满足任一条件停止并向用户报告：
- 登录连续失败（多半是账号或后端异常）
- 连续 5 个用例同根因失败（多半是环境问题，不是用例问题）
- 应用 URL 无法访问
- 用户中断

## 向阶段 3 交接

向用户打印：
- 最终统计：passed / failed / blocked / skipped
- 失败用例清单，每个用一句话归因
- `playwright_strategy: extract` 且 passed 的用例数 → 这些进入阶段 3
- 询问：现在进入阶段 3 提炼 Playwright，还是直接跳到阶段 4 生成报告？
