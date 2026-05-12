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

## Block discipline（重要）

`blocked` 是「**测试无法执行**」的状态，不是「**我懒得搭前置条件**」的状态。
在标 blocked 之前，**必须按以下分层判断**用例属于哪一类，对症下药。

### 分类原则：先看「需不需要第三方失败响应」

| 用例特征 | 选哪种解法 |
|---|---|
| 链路全在我方系统内（UI + server actions + DB），或外部调用预期是 SUCCESS | **层级 1: MCP 真实 UI 流程** |
| 链路含一次外部 API 调用，且**沙箱默认返回 SUCCESS** 就能推进 | **层级 1+2: MCP 真实流程 + 等异步通知** |
| 链路需要外部第三方返回 **FAILURE / 5xx / timeout / 特定异常**（沙箱无法被诱导返回这些） | **层级 3: SQL 注入终态** |

### 层级 1：MCP 真实 UI 流程（**默认**）

绝大多数「需要某种特定状态」的用例应当**通过浏览器自动化按真实用户流程造数据**，不要用 SQL 注入跳过业务逻辑。
真实流程能同时覆盖：表单校验 / server action / 状态机 / 操作日志 / UI 反馈，是端到端测试的本意。

例如：

| 用例需要 | 真实流程造法 |
|---|---|
| 需要 pending patient | 用 fresh incognito 注册一个新患者（PAT_001 那一套 SHA-256 brute-force 验证码） |
| 需要 rejected patient with known password | admin reject 一个 pending 患者 → admin 触发「重置密码」邮件 → 从 DB email_verifications 取 token brute-force → patient 设新密码 → 用 markh5 登录验证拦截 |
| 需要 confirmed appointment | admin 创建预约 → patient 同意 |
| 需要 reschedule_pending appointment | 同上，patient 「不同意」并填理由 |
| 需要 forgot-password reset token | `/patient/forgot-password` 提交 → DB 取 hash → brute-force 6 位 |

测试账号 + DB 连接串都在 `test/accounts.md`。

### 层级 2：MCP 真实流程 + 等异步通知

链路里嵌了一次外部 API 调用（如 NSS Auth / Capture），但**沙箱默认返回 SUCCESS** 时：
仍然走 MCP 真实操作，**等沙箱异步通知到达**（通常几秒到几十秒）。沙箱可达就不要 mock。

例如：

| 用例需要 | 流程 |
|---|---|
| 需要 treatment_pending（Auth 成功后） | MCP: patient consent 概算 → 触发 Auth → 等异步通知到 → status 推进到 treatment_pending |
| 需要 payment_success（Capture 成功后） | MCP: admin 录入诊疗费 → 触发 Capture → 等通知 → status=payment_success |
| 需要 additional_charge_success | 同上 + admin 点「追加請求」→ 触发 AddOn → 等通知 |

**注意**：这类用例耗时较长（异步通知会让单用例时长从 30 秒涨到 2-3 分钟），但**质量远高于 SQL 注入**——能验证整个真实链路。

### 层级 3：SQL 注入终态（**只在沙箱无法配合时**）

仅以下场景允许 SQL 注入：

- **第三方默认成功，无法诱导失败**：Auth fail / Capture fail / 绑卡 fail / getCardInfo 5xx / Refund fail / AddOn fail / Manual Query 返回非 SUCCESS
- **特殊时序场景**：通知延迟 / 通知乱序 / 重复通知（虽然重复通知可通过 cashier-mcp 重放，更精细）

SQL 注入的局限：**跳过了 server action 的状态机校验和副作用写入**。覆盖的只是「我方对该终态的展示和后续处理」，而**不是终态如何被生成的链路**。

注入时必须**同时维护多个相关表**保持一致性。例如「注入 estimate_failed 状态」要：
```sql
UPDATE consultations SET status='estimate_failed', failure_reason='Test injected' WHERE id=X;
INSERT INTO payment_transactions (type='Auth', status='failed', idempotency_key='..._A_1', ...);
```
不能只 UPDATE consultations 不写 payment_transactions，那样后续 retry-Auth 时 idempotency 计数会错。

---

只有以上三层**都不适用**的，才允许 blocked。在 cashier-hospital 这种本系统 + 沙箱可达的项目里，blocked 应该是**接近 0** 的状态。

例外（真 blocker）：真实第三方手动操作（如人工审批）/ 专用硬件（如读卡器）/ 时间依赖（如年末批处理）/ 不能在测试中触发的破坏性操作（如删全部用户）。

### 标 blocked 前的自检清单（强制）

**这是一道防线，不是建议**。宣布 blocked 前必须逐条对照下面的问题，任一答案为「是」就**不要标 blocked**，回去把它跑通：

- [ ] 解锁所需的能力是否在我手上？我有：admin 浏览器 + patient 浏览器（chrome-devtools-mcp）、SQL 写权限（test/accounts.md 中的 DSN）、SHA-256 / bcrypt 计算、curl、读源码、读环境变量。如果"解锁"只是这些工具的组合，就**没有理由把它标 blocked 让用户做**。
- [ ] 解锁步骤里出现「用户/你 去 X、用户/你 做 Y」的措辞？把「用户」二字替换成「我」再读一遍——如果替换后整段我都能做到，就去做。**「用户做几步手工」 ≠ 用例阻塞，那是我懒。**
- [ ] 这条用例的"解锁路径"是不是已经在 workflow 上面三个层级（MCP 真实流程 / 等异步通知 / SQL 注入）里有范例？有就照着做，不要假装它不适用。
- [ ] 如果只是「需要 fresh 患者」「需要某状态的预约/受诊」「需要 token brute-force」「需要构造特定状态的支付链」——这些都是 Level-1 范例覆盖的场景，不要标 blocked。

**只有以下情形才允许标 blocked**：

| 真 blocker | 例子 |
|---|---|
| 源代码改动 | 收银台 RSA 验签是写死的，需要开发加 `process.env.CASHIER_SKIP_VERIFY` 跳过开关 |
| 第三方私钥/账号 | 我没有 NSS 私钥，无法伪造签好名的 webhook |
| 重启 dev server | 改 env var 后需要重启 next dev，dev server 是用户的进程 |
| 真实手动操作 | 人工审批、读卡器、时间依赖批处理 |
| 不可逆破坏性操作 | 删全部用户、清整库 |

如果你正要标 blocked，但理由不属于上表任一类——回去做。

### skip_reason 的格式（只给用户看的两段）

```
**为什么卡住：** <一句话，告诉用户哪个外部条件不具备。直接讲外部约束，不写"我尝试过 X 失败"——那是执行日志，写到 STAGE2-HANDOFF.md。>

**下一步：** <一段可执行的动作。
  - 如果要找开发同学：指明改哪个文件哪一行/加哪个 env 开关。例：「在 src/lib/cashier/sign.ts 的 verifySignature 开头加 `if (process.env.CASHIER_SKIP_VERIFY === 'true') return true;`」
  - 如果是用户一次性配置：写明命令或步骤。
  - 不要说"高难度需要基础设施"——把具体动作落到地。>
```

**不要**暴露 `已尝试`、`难度 low/medium/high`、`根因`（带全角冒号）等字段给用户。这些是 skill 历史版本残留的执行内部状态，属于 STAGE2-HANDOFF.md 而不属于报告。

**格式细节**：粗体标签**包含全角冒号**（`**为什么卡住：** xxx`），不要写成 `**为什么卡住**：xxx` —— 后者在多数 markdown 渲染器下会因为 emphasis 闭合规则把冒号和正文换到下一行。

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
