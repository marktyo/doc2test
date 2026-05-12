---
name: doc2test
description: 基于产品需求文档（PRD）对 Web 项目进行 AI 驱动的 UI 自动化测试。读取项目的产品/技术文档，在 test/{version}/ 下生成结构化的测试大纲与测试用例，通过 chrome-devtools-mcp 在真实浏览器中执行并截图留证，将稳定场景提炼为 Playwright 脚本用于后续版本的快速回归，最终输出统一的 HTML 测试报告。当用户提出诸如「跑一下 AI 测试」「基于 PRD 测试」「v1.x 回归」「/doc2test」或「自动生成用例并执行」等需求时使用本 skill。
---

# AI UI 自动化测试流程

基于 PRD 的端到端测试方案。一个 skill、四个阶段、版本化产物，可在公司各项目间复用。

## 触发时机

- 用户要求基于 PRD 测试某个功能或版本（例如「基于 PRD 测一下 v1.1」）
- 用户运行 `/doc2test`，或要求执行「AI 自动化测试」
- 用户要求对某个已有版本进行回归
- 用户要求从产品文档生成测试大纲和用例

**不要在以下情形触发：**

- 编写单元测试（直接使用项目自身的测试框架）
- 纯代码审查（请使用 review skill）

## 启动前需要确认的输入

启动时第一步：读取 `test/.skill-config.yaml`。它是本 skill 在项目内的唯一配置入口，里面汇总 PRD 路径、应用 URL、登录模式、模块到 Playwright domain 的映射等。

- **若文件不存在**：进入初始化引导 —— 用 `templates/.skill-config.yaml` 拷贝生成，逐项向用户确认后写入。
- **若文件已存在**：直接读取，仅在字段缺失或失效时再询问。

| 输入项 | 解析方式 |
|---|---|
| **PRD 路径** | 默认 `docs/产品技术文档.md`。若不存在，向用户询问具体路径，并写回 `.skill-config.yaml` 的 `prd_path` |
| **版本号** | 命令行参数 `--version=`；否则读取 `package.json` 的 version 或询问用户。格式：`v1.0`、`v1.1`、`v2.0-rc1` |
| **应用访问 URL** | 读 `.skill-config.yaml` 的 `app_url`；缺失则由 `package.json` 的 dev 脚本端口推断后回填，仍推断不出则询问 |
| **测试账号** | 读 `test/accounts.md`（不进 git）；不存在则向用户询问后生成 |
| **覆盖的语言/地区** | 从 PRD 读取；默认仅覆盖项目主语言 |

## 依赖的工具

- `chrome-devtools-mcp` MCP 服务 —— 阶段 2 使用。进入阶段 2 前先确认其可用，不可用则提示用户安装。
- Node + npm/pnpm —— 阶段 3、阶段 4 的 Playwright 提炼与执行需要。

## 四个阶段

按顺序执行。每个阶段的详细操作步骤分别保存在 `workflows/` 目录，进入对应阶段时再加载阅读。

### 阶段 1 —— 设计（`workflows/1-design.md`）

读取 PRD → 在 `test/{version}/` 下生成测试大纲和测试用例。遵循 `role.md` 的设计规范。对迭代版本（非 v1.0），先与上一版本的 PRD 快照做 diff，将用例分类为 `unchanged | modified | new | removed`。

**输出：** `test/{version}/test-outline.md`、`test/{version}/test-cases.md`、`test/{version}/prd-snapshot.md`，迭代版本另加 `test/{version}/prd-diff.md`。

### 阶段 2 —— 执行（`workflows/2-execute.md`）

对每个分类为 `modified | new` 的用例（首版则对所有用例）通过 chrome-devtools-mcp 执行。采集截图、console 日志、网络异常。每个用例独占一个文件夹 `test/{version}/{case-id}/`。`unchanged` 的用例在本阶段不执行 —— 阶段 4 由 Playwright 覆盖。

**输出：** `test/{version}/{case-id}/{meta.json, steps.md, screenshots/, console.log}`。

### 阶段 3 —— 提炼（`workflows/3-extract.md`）

将所有「执行通过且 `playwright_strategy: extract`」的用例生成或更新对应的 Playwright 脚本到 `test/playwright/specs/`。若项目尚未配置 Playwright，则同时生成 `playwright.config.ts` 与 `fixtures/`。脚本目录放在版本目录之外 —— Playwright 是活的回归套件，不是某个版本的快照。

**输出：** `test/playwright/specs/*.spec.ts`，首次执行另加 `test/playwright/{playwright.config.ts, fixtures/}`。

### 阶段 4 —— 回归 + 报告（`workflows/4-regress.md`）

运行 `npx playwright test --reporter=html`，将 AI 执行结果与 Playwright 结果合并为一个统一的 HTML dashboard，落到 `test/{version}/report/index.html`。

**输出：** `test/{version}/report/{index.html, ai-run.html, playwright-run.html, summary.json, assets/}`。

## 通用不变量

以下规则贯穿所有阶段，存疑时回到此处复核：

1. **版本隔离。** 与某次执行强相关的产物全部进入 `test/{version}/`，只有 Playwright 套件（`test/playwright/`）跨版本共享。
2. **一个用例一个文件夹。** `test/{version}/{case-id}/` 是证据的最小单元，截图绝不直接散落在版本根目录。
3. **meta 即唯一事实源。** 每个用例的 `meta.json` 是其执行状态与 `playwright_strategy` 的权威，其它产物（报告、回归过滤）都从中派生。
4. **不允许静默跳过。** 用例被跳过必须在 `meta.json` 中记录原因（`status: skipped`、`skip_reason: ...`），并在报告中显式呈现。
5. **PRD 快照是强制项。** 每个版本都必须写 `prd-snapshot.md` —— 缺它会导致下一版本无法做 diff。
6. **浏览器操作的卫生约定。** 使用 chrome-devtools-mcp 时切换 tab 必须 `bringToFront`，长页面操作前先把目标滚动到视野内。
7. **Playwright 目录扁平。** `test/playwright/specs/{domain}/{feature}.spec.ts`，按业务领域分组，绝不按版本分组。

## 规范文档

- 完整目录结构与命名规范：`conventions/artifacts-layout.md`
- 用例设计规则（分类比例、ID 格式、覆盖目标等）：`role.md`
- 真实项目的端到端配置示例：`examples/`（如 `examples/healthcare.md` 是医院场景的完整走例）

## 模板

位于 `templates/`：

- `.skill-config.yaml` —— 项目级 skill 配置（首次进入时生成到 `test/.skill-config.yaml`）
- `test-outline.md` —— 测试大纲结构
- `test-cases.md` —— 用例表格格式（必须与 `role.md` 第 7 节一致）
- `playwright.spec.ts` —— Playwright 脚本骨架（含 case id 可追溯注释）
- `playwright.config.ts` —— 项目根目录无 Playwright 配置时生成的最小化配置
- `auth.fixture.ts` —— Playwright storageState 引用
- `report-index.html` —— 统一 HTML 报告 dashboard
- `report-ai-run.html` —— AI 执行详情子页
- `report-assets/` —— 报告的 CSS / JS
- `meta.schema.json` —— 单用例 meta 文件的 schema

## 快速开始（给执行本 skill 的助手）

1. 读取或初始化 `test/.skill-config.yaml`，解析全部启动输入。
2. 若 `test/{version}/` 已存在产物，询问用户：继续 / 重做 / 中止。
3. 进入阶段 1 —— 读取 `workflows/1-design.md` 并按照其内容执行。
4. 每个阶段结束后，先用一段话向用户汇报，再进入下一阶段；用户可在任一阶段边界打断或重定向。
5. 使用 `TodoWrite` 跟踪阶段进度 —— 同一时间只保留一个 in_progress 项。
