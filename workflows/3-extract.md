# 阶段 3 —— 提炼 Playwright 脚本

把稳定且已通过的用例转换为 Playwright 脚本，用于后续版本的快速回归。本阶段紧接阶段 2 —— LLM 刚刚走完同一流程，操作细节还在新鲜状态。

## 提炼资格

一个用例同时满足以下条件才进入提炼：

- `meta.status === "passed"`
- `meta.playwright_strategy === "extract"`
- **存在 `test/{version}/{case-id}/selectors.json`**（阶段 2 §2.d.1 强制要求）—— 这是阶段 3 提炼 Playwright spec 的唯一权威来源。无此文件 → 立即把 `playwright_strategy` 改为 `ai-only`，不要凭描述瞎写 selector。
- 用例的每个校验步骤都是可验证的（非主观判断）—— 纯 UX 判断类即使被标为 `extract` 也排除（视作策略标注错误，把 meta 改为 `ai-only`）

`defer` 与 `ai-only` 用例在本阶段被有意跳过。

## 项目初始化（仅第一次）

按以下顺序检查项目内的 Playwright 状态：

### 情形 A —— 项目根目录已有 `playwright.config.ts`

不要覆盖。改为读取它：

1. 解析 `testDir`（绝对路径）。
2. 如果该路径不在 `test/playwright/specs/` 下 —— 沿用项目既定路径，新 spec 放到那里（按本 skill 的 `{domain}/{feature}.spec.ts` 二级分组）。
3. 检查 `baseURL` 是否与 `.skill-config.yaml` 的 `app_url` 一致；不一致先告知用户，由用户决定改哪一边。
4. 生成 `test/playwright/fixtures/auth.ts` 与角色 storageState JSON（同情形 B 步骤 2、3）。
5. 视情况补充 `test:e2e` 脚本（若 `package.json` 中已有则跳过）。

### 情形 B —— 项目根目录没有 `playwright.config.ts`

初始化整套配置：

1. 把 `templates/playwright.config.ts` 复制到项目根 `playwright.config.ts`，`baseURL` 设为 `.skill-config.yaml` 的 `app_url`，`testDir` 设为 `'./test/playwright/specs'`。
2. 生成 `test/playwright/fixtures/auth.ts`：以 `templates/auth.fixture.ts` 为骨架，读取 `.skill-config.yaml` 的 `auth_modes`，把 `{{AUTH_EXPORTS_BEGIN}} ... {{AUTH_EXPORTS_END}}` 之间的内容替换为按 `auth_modes` 的 key 动态渲染的 `export` 列表：
   ```ts
   // 对每个 role in auth_modes：
   export const {role}StorageState = path.join(fixturesDir, 'auth-{role}.json');
   ```
   `{role}` 取 lowerCamelCase（例：`auth_modes` 含 `customer`、`seller`、`admin` → 三个 export 常量）。
3. 把阶段 2 采集的 storage state 按角色落到 `test/playwright/fixtures/auth-{role}.json`（每个 `auth_modes` key 对应一个 JSON）。
3.1. **从 `test/playwright/fixtures/login-recipe.json`（阶段 2 §"登录 recipe 持久化" 写入）渲染 `test/playwright/global-setup.ts`**。绝不要凭模板假设登录页 selector，**逐条**翻译 recipe 的 `steps[]` 数组：

   ```ts
   // 由 login-recipe.json.patient.steps 渲染：
   async function loginPatient(baseURL: string) {
     const browser = await chromium.launch();
     const ctx = await browser.newContext();
     const page = await ctx.newPage();
     await page.goto(`${baseURL}${recipe.patient.login_url}`);
     // recipe step 1: { action: 'fill', locator_strategy: 'input_nth', locator_value: '0', ... }
     await page.locator('input').nth(0).fill(credentials.patient.email);
     await page.locator('input').nth(1).fill(credentials.patient.password);
     await page.getByRole('button', { name: '登录' }).click();
     await page.waitForURL(new RegExp(recipe.patient.success_url_pattern));
     await ctx.storageState({ path: patientStorageState });
     await browser.close();
   }
   ```

   每一行 Playwright 调用必须对应 recipe 中的某条 step；不允许凭印象加 fallback selector。如果 recipe 缺某角色 → global-setup 不为该角色生成 login 函数 + 向用户报错。

4. 检测包管理器（`pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`），在 `package.json` 加入 `test:e2e` 脚本：
   ```json
   "test:e2e": "playwright test"
   ```
5. 将 `@playwright/test` 加入 devDependency。安装前先征求用户同意（影响 lockfile）。
6. 询问用户后再执行 `npx playwright install chromium`。
7. 把以下条目加入 `.gitignore`：
   - `/playwright-report/`
   - `/test-results/`
   - `/test/playwright/fixtures/auth-*.json`（storage state 含会话 token）

## 脚本组织

按业务领域分组（**不**按用例 ID，**不**按版本）。领域名取自 `.skill-config.yaml` 的 `module_domain_mapping`。

下方为通用电商示例：

```
test/playwright/specs/
├── auth/
│   ├── login.spec.ts
│   └── register.spec.ts
├── product/
│   ├── list.spec.ts
│   └── detail.spec.ts
├── cart/
│   └── checkout.spec.ts
├── order/
│   ├── submit.spec.ts
│   └── status.spec.ts
└── payment/
    ├── pay.spec.ts
    └── refund.spec.ts
```

领域归类源自用例的 `module` 字段，再经 `module_domain_mapping` 转换。映射表里没有的模块向用户问一次后写回配置。

## 生成规则

对每个合格用例：

1. 定位或创建目标 spec 文件。如果该文件在上一版本已存在，**追加** 新的 `test()` 块，不要覆写旧的。
2. 在 spec 内写：
   ```ts
   test('CASE_ID — 用例名称', async ({ page }) => {
     // case_id: ORD_001
     // playwright_strategy: extract
     // first_added: v1.0
     // last_updated: v1.1
     ...
   });
   ```
3. 从 `selectors.json` 的 `interactions[]` 数组**逐条翻译**成 Playwright 调用。**locator_strategy → Playwright API 映射**：

   | locator_strategy | 翻译成 |
   |---|---|
   | `role` | `page.getByRole(role, { name, exact: true })` |
   | `label` | `page.getByLabel(value, { exact: true })` |
   | `placeholder` | `page.getByPlaceholder(value)` |
   | `text` | `page.getByText(value, { exact: true })`（若 `selectors.json` 里 `exact: false` 才放宽） |
   | `input_nth` | `page.locator('input').nth(N)` |
   | `css` | `page.locator(value)` |

   带 `nth: N` 的字段统一加 `.nth(N)`。**不要**凭印象写跨语言 OR 正则（如 `/邮箱|email/i`）—— `selectors.json` 已经记录了实际渲染的文本，照抄。

4. 从 `selectors.json` 的 `assertions[]` 翻译成 `expect()` 断言，每个 `intent` 对应一行注释。
5. **锁定 locale**：每个 spec 文件顶部 `test.beforeEach` 设 cookie `patient_locale` = `selectors.json.locale`（或 `.skill-config.yaml` 的 `options.default_locale`），保证回归时 next-intl 渲染同一份文本，文案 selector 不漂移：

   ```ts
   test.beforeEach(async ({ context }) => {
     await context.addCookies([{ name: 'patient_locale', value: 'ja', domain: 'localhost', path: '/' }]);
   });
   ```

6. 阶段 2 中的主观检查**不**翻译，留给 LLM 阶段。加一行注释：`// 主观检查已故意省略：...`。
7. 按用例的 `auth` 模式使用对应的 `storageState` fixture。

## 修改已有脚本（迭代）

`prd-diff.md` 中分类为 `modified` 的用例：
- 定位 `test('CASE_ID — ...')` 块。
- 按新流程更新，同时更新 `// last_updated:` 注释。
- 不要删除重建 —— 保留 git history。

分类为 `removed` 的用例：
- 删除对应的 `test()` 块。
- 若 spec 文件因此变空，删除该文件。

## 验证（强制真跑，不是 --list）

生成 / 更新脚本后**必须**：

1. **语法门**：跑 `npx playwright test --list` 确认全部 spec 都能被 Playwright 解析。
2. **行为门**：对每个受影响的 spec **单独真跑一次** `npx playwright test {file}`。这一步不可跳过 —— --list 只能发现语法错，selector 错只有真跑才暴露。
3. **回填**：每个跑通的用例在 `meta.json` 写入：
   - `playwright_spec`：脚本文件相对路径
   - `playwright_test_name`：`test()` 的完整标题

**不要**因为 Playwright 跑失败就把阶段 2 的 `meta.status` 改为 `failed` —— 阶段 2 通过的事实不变，这只是提炼质量问题。但是失败用例**必须**走下面的自动降级。

## 自动降级（强制）

任一以下情形 → 用例**当场降级**为 `ai-only`，不进入 Playwright 套件：

| 情形 | 处理 |
|---|---|
| `selectors.json` 不存在 | `playwright_strategy = "ai-only"`，`notes` 写 `"missing selectors.json from stage 2"` |
| 行为门跑失败 | `playwright_strategy = "ai-only"`，`notes` 写 `"playwright spec failed first run: <error 一行摘要>"`；**同时删除**该 spec 中刚加的 `test()` 块（避免污染回归套件） |
| 需要不确定性等待 | `playwright_strategy = "ai-only"`，`notes` 写 `"requires non-deterministic wait: <场景>"` |
| 翻译后断言全是主观判断 | `playwright_strategy = "ai-only"`，`notes` 写 `"all assertions subjective"` |

**降级数量上限**：单次阶段 3 提炼超过 30% 用例降级 → 暂停，向用户报警："selectors.json 质量不足，阶段 2 的 §2.d.1 没认真做"。不要带着大量降级继续。

在阶段 3 交接报告中分别列出：成功 spec 数、降级 spec 数（每条带原因摘要）、自动清理掉的 spec 块数。

## 向阶段 4 交接

向用户打印：
- 新建 spec 数量与路径
- 修改 spec 数量与路径
- 删除 spec 数量与路径
- 由 `extract` 降级为 `ai-only` 的用例数与原因
- 回归套件当前的 Playwright 用例总数
