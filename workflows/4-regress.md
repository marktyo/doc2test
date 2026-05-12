# 阶段 4 —— 回归 + 统一报告

跑完整个 Playwright 套件，把回归结果与 AI 执行结果合并为一个 HTML dashboard。

## 预检

1. 确认项目根目录的 `playwright.config.ts` 存在。若不存在，说明项目从未跑过阶段 3 —— 打印警告并跳过回归部分，但仍生成 AI 部分的报告。
2. 确认应用仍在 `.skill-config.yaml` 的 `app_url` 可访问。
3. 确认 storage state fixture 未过期，过期则重登录后覆写 JSON。

## 跑 Playwright

```
PW_HTML_OUT=test/{version}/report/playwright-html \
PW_JSON_OUT=test/{version}/report/playwright-results.json \
npx playwright test --reporter=html,json
```

上述环境变量被 `templates/playwright.config.ts` 的 `PW_HTML_OUT` / `PW_JSON_OUT` 读取，产物落到：
- HTML 报告 → `test/{version}/report/playwright-html/`
- JSON 结果 → `test/{version}/report/playwright-results.json`

如果项目使用自己的 `playwright.config.ts`，需要先确认它的 reporter 是否支持这两个环境变量；不支持则在阶段 4 临时构造一份临时 config 跑回归（不修改项目根 config）。

记录退出码 —— 非零代表有失败。

## 生成 summary.json

由 `scripts/build-report.mjs` 一并写出；schema 见 `conventions/artifacts-layout.md`。

关键聚合：
- `ai_run.total / passed / failed / blocked / skipped`
- `ai_run.by_module`、`ai_run.by_type`
- `playwright_run.total / passed / failed / duration_ms`（无 Playwright 结果时为 `null`）
- `coverage_self_eval` —— 从大纲的「设计自评」章节读取
- `diff_from_prev` —— 从 `prd-diff.md` 读取（v1.0 跳过）

## 构建统一 HTML dashboard

使用 SKILL 自带的报告生成器（**推荐方式**）：

```bash
node .claude/skills/doc2test/scripts/build-report.mjs \
  --version {version} \
  --project "{project-name}" \
  [--prev {previous-version}]
```

生成器会自动完成：
- 读取所有 `test/{version}/{case-id}/meta.json`（+ 可选的 `steps.md`、`console.log`）
- 读取 `test/{version}/report/playwright-results.json`（若已跑过 Playwright）
- 渲染 `templates/report-index.html` → `test/{version}/report/index.html`
- 渲染 `templates/report-ai-run.html` → `test/{version}/report/ai-run.html`
- 拷贝 `templates/report-assets/*` → `test/{version}/report/assets/`
- 写出 `test/{version}/report/summary.json`
- 提取 Playwright 失败列表内联到 index 的「Playwright 回归」tab 顶部

### 生成的 ai-run.html 关键 UX

- 顶部：5 张汇总卡片（通过 / 失败 / 阻塞+跳过 / 回归通过 / 回归失败）；前 3 张可点击直接筛选 AI 表
- 「仅看待处理」按钮：一键过滤出 failed + blocked
- 表格列：ID · 名称 · 模块 · 类型 · 优先级 · **状态** · **原因 / 备注**（行内显示 skip_reason / failure / notes，hover 看完整文本）· 用时 · PW 标
- 行视觉：blocked = 浅黄背景、failed = 浅红背景、passed = 默认 / 斑马条纹
- 展开区按优先级显示：先「原因」框（彩色边栏，blocked/failed/info），再 steps.md，再截图缩略图，最后 PW spec 链接与 console.log
- 失败 / 阻塞用例**不需要 steps.md** 也能在行内立刻看到原因

HTML 自包含 —— 直接 `open index.html` 即可查看。

### 与 Playwright 的交叉链接

每个 `meta.playwright_spec` 非空的用例，在 PW 列展示「▶」标记并以 `title` tooltip 给出 Playwright test 全名；展开区有 `Playwright spec: ... — test name` 文本行可复制。

### 与 Playwright 的交叉链接

在 `ai-run.html` 中，对每个 `meta.playwright_spec` 非空的用例，加一个「▶ Playwright: {test name}」链接，深度跳转到 Playwright HTML 报告（Playwright 支持按 test title 定位）。

## 校验

声明完成前确认：

- [ ] `test/{version}/report/index.html` 在浏览器直接打开无报错
- [ ] 所有截图缩略图能渲染
- [ ] Playwright HTML 报告的 iframe / 链接可加载
- [ ] `summary.json` 是合法 JSON，符合 schema
- [ ] `meta.json` 中没有任何用例停留在 `status: "running"`
- [ ] CI 可读：`summary.json.ai_run.failed === 0 && playwright_run.failed === 0` ↔ 绿灯

## 向用户交接

向用户打印：
- 报告绝对路径：`test/{version}/report/index.html`
- 一行总结：`AI 42/47 通过（3 失败，1 阻塞，1 跳过）· Playwright 37/38 通过（1 失败）`
- 失败清单：`[AI|PW] {case-id} — 一句话原因`
- 询问是否打开报告（征得用户同意后 `open` / `xdg-open`）
- 提醒：若本版有 `defer` 用例已稳定，可考虑下次手动把 meta 改为 `extract` 重跑阶段 3。

## CI 模式（可选）

携带 `--ci` 参数时：
- 跳过阶段边界的用户确认
- 任一 AI 或 Playwright 失败则非零退出
- 不主动提示打开报告
- 在 stdout 打印机器可读总结：直接输出 `summary.json` 内容
