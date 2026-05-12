# 产物目录与命名规范

所有文件的存放位置。把本文件视作权威 spec —— 如果有想放到其他位置的冲动，先更新本文件再动手。

## 顶层结构

```
<项目根目录>/
├── playwright.config.ts                  # Playwright 配置（仍按社区惯例放根目录）
└── test/
    ├── .skill-config.yaml                # 本 skill 在项目内的唯一配置入口
    ├── accounts.md                       # 测试账号（必须进 .gitignore）
    ├── playwright/                       # 活的回归套件（不按版本归档）
    │   ├── fixtures/
    │   │   ├── auth.ts                   # storageState 复用（按 auth_modes 动态生成）
    │   │   ├── auth-{role}.json          # 每个角色一份会话快照（不进 git）
    │   │   └── data.ts                   # 共用测试数据
    │   └── specs/
    │       └── {domain}/{feature}.spec.ts
    │
    └── {version}/                        # 单版本产物
        ├── prd-snapshot.md               # 本版 PRD 的冻结副本
        ├── prd-diff.md                   # 相对上一版本的 diff（v1.0 没有该文件）
        ├── test-outline.md
        ├── test-cases.md
        ├── {case-id}/                    # 每个用例一个文件夹
        │   ├── meta.json
        │   ├── steps.md
        │   ├── screenshots/
        │   │   ├── 01-{slug}.png
        │   │   └── 02-{slug}.png
        │   └── console.log
        └── report/
            ├── index.html                # 统一报告入口
            ├── ai-run.html               # AI 执行详情子页
            ├── playwright-html/          # Playwright HTML reporter 产物
            ├── playwright-results.json
            ├── summary.json              # 机器可读的汇总
            └── assets/                   # CSS / JS / 字体
```

**关于 `playwright.config.ts` 位置：**
- 若项目根目录**已有** `playwright.config.ts` —— 不要覆盖；读取它的 `testDir`，把新 spec 放到对应位置。
- 若**没有** —— 在根目录创建，`testDir: './test/playwright/specs'`。
- spec 永远放在 `test/playwright/specs/`，与 `test/` 下的其它测试产物保持在同一棵树下。

## test/.skill-config.yaml schema

完整示例见 `templates/.skill-config.yaml`。核心字段：

```yaml
prd_path: docs/产品技术文档.md          # PRD 路径，相对项目根
app_url: http://localhost:3000          # 应用访问根 URL

# 登录态信息，key 为项目自定义的角色名
# 保留字：none（匿名）、fresh（每例独立 incognito）
auth_modes:
  <role>:
    login_url: <path>

# 用例 module 字段到 Playwright domain 目录的映射
module_domain_mapping:
  <ModuleName>: <domain-dir-name>

options:
  default_locale: <locale>              # 主要测试的语言
  ai_run_timeout_per_case_s: 180        # 单用例 LLM 执行超时
```

## test/accounts.md 模板

```markdown
# 测试账号

> 切勿提交到 git。在仓库根目录的 .gitignore 中加入 `test/accounts.md`。
> 下方角色 key 必须与 .skill-config.yaml 的 auth_modes 一致。

## <role>

- email: <test-account@example.com>
- password: <password>
- otp_secret: <base32 secret>   # 可选，二段認証時使用
```

## 命名规则

| 项目 | 格式 | 示例 |
|---|---|---|
| 版本号 | `v{major}.{minor}[-{tag}]` | `v1.0`、`v1.1`、`v2.0-rc1` |
| 用例 ID | `{模块}_{NNN}`（序号补零到 3 位） | `ORD_001`、`PAY_023` |
| 用例文件夹 | 与用例 ID 完全一致 | `ORD_001/` |
| 截图文件名 | `{NN}-{slug}.png`（编号补零到 2 位） | `01-login-page.png` |
| Playwright 脚本 | `test/playwright/specs/{domain}/{feature}.spec.ts` | `payment/auth-flow.spec.ts` |

截图 slug：仅使用小写、英文连字符分隔、ASCII 字符；不超过 40 字符。

## meta.json（每个用例）

下方为电商场景示例。字段含义见 `templates/meta.schema.json`。

```json
{
  "id": "ORD_001",
  "name": "用户提交订单 - 正常流程",
  "type": "功能",
  "module": "Order",
  "priority": "高",
  "tags": ["smoke", "happy-path"],
  "auth": "customer",
  "playwright_strategy": "extract",
  "status": "passed",
  "started_at": "2026-05-12T10:23:00+08:00",
  "finished_at": "2026-05-12T10:24:18+08:00",
  "duration_ms": 78000,
  "skip_reason": null,
  "failure": null,
  "screenshots": ["01-cart.png", "02-checkout.png", "03-order-placed.png"],
  "playwright_spec": "test/playwright/specs/order/submit.spec.ts",
  "playwright_test_name": "customer submits order - happy path",
  "notes": ""
}
```

### status 取值

- `passed` —— 全部预期结果验证通过
- `failed` —— 至少一个预期结果未达成（必须填 `failure`）
- `blocked` —— 无法执行（如前置条件搭建失败，必须填 `skip_reason`）
- `skipped` —— 主动跳过（如迭代版本的 `unchanged` 用例，必须填 `skip_reason`）
- `running` —— 仅阶段 2 进行中允许，绝不允许停在该状态
- `pending` —— 阶段 1 生成完成、尚未执行

### failure 结构

```json
{
  "step": 3,
  "expected": "弹出「邮箱已注册」提示",
  "actual": "提交成功，跳转到首页",
  "screenshot": "03-after-submit.png"
}
```

## summary.json（每个版本）

```json
{
  "version": "v1.1",
  "generated_at": "2026-05-12T18:00:00+08:00",
  "previous_version": "v1.0",
  "ai_run": {
    "total": 47,
    "passed": 42,
    "failed": 3,
    "blocked": 1,
    "skipped": 1,
    "by_module": { "Order": { "total": 12, "passed": 11, "failed": 1 } },
    "by_type":   { "功能": 26, "边界": 12, "异常": 9 }
  },
  "playwright_run": {
    "total": 38,
    "passed": 37,
    "failed": 1,
    "duration_ms": 124000
  },
  "coverage_self_eval": {
    "equivalence_class": "100%",
    "boundary": "92%",
    "exception": "84%",
    "pairwise_used": true
  },
  "diff_from_prev": {
    "unchanged": 28,
    "modified": 9,
    "new": 8,
    "removed": 2
  }
}
```

## 不允许放在以下位置

- ❌ 散落在版本根目录的截图 —— 必须放进 `{case-id}/screenshots/`
- ❌ Playwright 脚本放在 `test/{version}/` 下 —— 应扁平放在 `test/playwright/specs/` 中
- ❌ `playwright.config.ts` 放在 `test/` 下 —— 必须放项目根目录（社区惯例 / IDE 集成依赖）
- ❌ 测试 fixture 放在 `test/{version}/` 下 —— 共用的放 `test/playwright/fixtures/`，一次性的内联在脚本中
- ❌ `accounts.md` 进 git —— 必须在 `.gitignore` 中
- ❌ PRD 副本出现在除 `test/{version}/prd-snapshot.md` 之外的任何位置
- ❌ `node_modules`、构建产物，以及任何非测试文件出现在 `test/` 下
