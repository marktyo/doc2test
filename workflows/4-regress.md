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

读取所有 `test/{version}/{case-id}/meta.json` 与 Playwright JSON 结果，按 `conventions/artifacts-layout.md` 的 schema 写出 `test/{version}/report/summary.json`。

关键聚合：
- `ai_run.total / passed / failed / blocked / skipped`
- `ai_run.by_module`、`ai_run.by_type`
- `playwright_run.total / passed / failed / duration_ms`
- `coverage_self_eval` —— 从大纲的「设计自评」章节读取
- `diff_from_prev` —— 从 `prd-diff.md` 读取（v1.0 跳过）

## 构建统一 HTML dashboard

将 `templates/report-index.html` 复制到 `test/{version}/report/index.html`，原地编辑：内联 `summary.json` 的数据，并把 iframe / 链接指向：
- `ai-run.html`（下一步生成 —— AI 执行详情子页）
- `playwright-html/index.html`（Playwright 自带报告）

把 `templates/report-assets/*` 复制到 `test/{version}/report/assets/`。

### 生成 ai-run.html

按 `meta.json` 渲染：
- 顶部：汇总卡片（总数、通过、失败、阻塞、跳过）
- 过滤 / 搜索栏（按模块、类型、状态、标签）
- 用例列表 —— 每行可展开显示：
  - `steps.md` 内容
  - 截图缩略图（点击放大；相对报告目录的路径：`../{case-id}/screenshots/01-...png`）
  - console.log 链接
  - 对应的 Playwright test 链接（若已提炼）
- 覆盖度自评章节
- （迭代版本）相对上一版的差异章节

HTML 必须自包含 —— 直接 `open index.html` 即可查看，所有相对链接可正常打开。

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
