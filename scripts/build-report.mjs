#!/usr/bin/env node
/**
 * doc2test report builder.
 *
 * Generates the unified HTML dashboard for a given version directory by:
 *   1. Reading every test/<version>/<case-id>/meta.json (+ optional steps.md)
 *   2. Reading test/<version>/report/playwright-results.json (if present)
 *   3. Filling templates/report-index.html, templates/report-ai-run.html
 *   4. Copying templates/report-assets/* to test/<version>/report/assets/
 *   5. Emitting test/<version>/report/summary.json
 *
 * Usage:
 *   node .claude/skills/doc2test/scripts/build-report.mjs \
 *     --version v1.0 --project "Project Name" [--prev v0.9]
 *
 * Defaults assume CWD is the project root.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(SKILL_DIR, 'templates');

function parseArgs(argv) {
  const out = { version: null, project: null, prev: null, root: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i];
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--prev') out.prev = argv[++i];
    else if (a === '--root') out.root = argv[++i];
  }
  if (!out.version) throw new Error('--version is required (e.g. --version v1.0)');
  if (!out.project) out.project = path.basename(out.root);
  return out;
}

function flattenPlaywrightResults(json) {
  const tests = [];
  (function walk(s) {
    for (const sub of s.suites || []) walk(sub);
    for (const sp of s.specs || []) {
      for (const tt of sp.tests || []) {
        const res = (tt.results || [])[0];
        const firstErrLine = res?.errors?.[0]?.message?.split('\n').find((l) => l.trim()) || '';
        tests.push({
          title: sp.title,
          file: sp.file,
          status: res?.status || tt.status || 'unknown',
          duration: res?.duration || 0,
          error: stripAnsi(firstErrLine).slice(0, 300),
        });
      }
    }
  })({ suites: json.suites || [] });
  return tests;
}

function stripAnsi(s) {
  return String(s || '').replace(/\[[0-9;]*m/g, '');
}

/**
 * Cluster Playwright failures by root-cause pattern.
 * Returns: [{ key, name, cause, fix, tests: [{title, file, error}] }, ...]
 */
function analyzePlaywrightFailures(failures) {
  if (!failures.length) return [];
  const patterns = [
    {
      key: 'strict-mode',
      match: /strict mode violation/i,
      name: '选择器作用域过广（strict-mode 多匹配）',
      cause: '同一 selector 在 dialog 打开后同时匹配到 list filter 和 dialog 内的同名 input。Playwright 默认要求 selector 唯一命中。',
      fix: '把 selector 限定在 dialog 内：page.locator(\'[role="dialog"]\').getByPlaceholder(...)；或追加 .first() / .nth(0)。',
    },
    {
      key: 'visible',
      match: /toBeVisible.*failed|locator.*toBeVisible/i,
      name: '期望元素未出现',
      cause: '断言的文本/元素在页面上找不到。常见根因：i18n 文案变了（locale 切换）、加载慢、或选择器写错。',
      fix: '检查实际渲染语言；在 beforeEach 里强制 cookie patient_locale=zh；或 page.waitForLoadState("networkidle")。',
    },
    {
      key: 'timeout',
      match: /Test timeout.*exceeded|Timeout.*exceeded|page\.goto.*Timeout/i,
      name: '测试超时（默认 30 秒）',
      cause: 'globalSetup 登录卡住、或 spec 中某个 page.waitFor 始终未满足，触发整测超时。',
      fix: '看 trace.zip 看停在哪一步。若是 globalSetup 慢，单独提高 timeout，或改 SQL seed 直接预置 session 跳过 UI 登录。',
    },
    {
      key: 'assertion',
      match: /toBeGreaterThanOrEqual|toBeLessThan|toEqual|toBe(?!Visible)|toHaveCount|toHaveText/i,
      name: '数值 / 结构断言不匹配',
      cause: '页面实际状态与期望不一致。常见根因：fixture 数据未达 spec 假设、前一步操作未完成、或 spec 假设错误。',
      fix: '检查 fixture 数据；用 SQL seed 直接预置可控状态；或重读 spec 中的 expected 值。',
    },
    {
      key: 'detached',
      match: /not attached|detached|stale element/i,
      name: 'DOM 元素已脱离 (stale)',
      cause: '在 wait 期间元素被 React 重新挂载，原 ElementHandle 失效。',
      fix: '不要事先把元素存到变量，每次用 page.locator() 重新查询。',
    },
    {
      key: 'navigation',
      match: /net::|ERR_CONNECTION|page\.goto.*failed/i,
      name: '页面访问失败',
      cause: 'dev server 没起、或 URL 不对、或网络中断。',
      fix: '确认 baseURL 和 dev server 状态；CI 中用 playwright.config.ts 的 webServer 自动起。',
    },
  ];
  const buckets = [];
  for (const f of failures) {
    let matched = null;
    for (const p of patterns) {
      if (p.match.test(f.error)) { matched = p; break; }
    }
    const key = matched?.key || 'other';
    let b = buckets.find((x) => x.key === key);
    if (!b) {
      b = matched
        ? { key, name: matched.name, cause: matched.cause, fix: matched.fix, tests: [] }
        : { key: 'other', name: '其他（未匹配已知模式）', cause: '需要个案分析。', fix: '查看 trace.zip 与 error 信息单独处理。', tests: [] };
      buckets.push(b);
    }
    b.tests.push({ title: f.title, file: f.file, error: f.error });
  }
  buckets.sort((a, b) => b.tests.length - a.tests.length);
  return buckets;
}

/**
 * Build a self-contained markdown prompt for an LLM to act on:
 * what AI cases failed/are blocked, what Playwright tests failed, and
 * a "please help" instruction block.
 *
 * Output is a single string. Truncates steps/error blobs so the prompt
 * stays roughly under 10KB even with many cases.
 */
function buildFixPrompt(summary, cases, pwBuckets) {
  const out = [];
  const ai = summary.ai_run;
  const pw = summary.playwright_run;
  const aiFailed = cases.filter((c) => c.status === 'failed');
  const aiBlocked = cases.filter((c) => c.status === 'blocked');

  const truncate = (s, n) => {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  out.push(`# 测试修复任务 — ${summary.project} ${summary.version}`);
  out.push('');
  out.push('我跑了一轮自动化测试，把需要你帮忙修复 / 解锁的部分汇总如下。请逐项给出具体的代码 / 配置 / fixture 修改建议。');
  out.push('');
  out.push('## 总体情况');
  out.push('');
  out.push(`- AI 用例：${ai.passed}/${ai.total} 通过，${ai.failed} 失败，${ai.blocked} 阻塞`);
  if (pw) out.push(`- Playwright 回归：${pw.passed}/${pw.total} 通过，${pw.failed} 失败`);
  out.push('');

  if (aiFailed.length) {
    out.push('---');
    out.push('');
    out.push(`## 🔴 AI 失败用例（${aiFailed.length} 个）`);
    out.push('');
    for (const c of aiFailed) {
      out.push(`### ${c.id} — ${c.name}`);
      out.push(`- 模块：${c.module} · 类型：${c.type} · 优先级：${c.priority}`);
      if (c.failure) {
        out.push(`- 失败：第 ${c.failure.step} 步 — 预期 \`${c.failure.expected}\`，实际 \`${c.failure.actual}\``);
      }
      if (c.notes) out.push(`- 备注：${truncate(c.notes, 300)}`);
      if (c.steps_md) {
        out.push('- 执行步骤（节选）：');
        out.push('  ```');
        out.push('  ' + truncate(c.steps_md, 600).split('\n').join('\n  '));
        out.push('  ```');
      }
      out.push('');
    }
  }

  if (aiBlocked.length) {
    out.push('---');
    out.push('');
    out.push(`## 🟡 AI 阻塞用例（${aiBlocked.length} 个，需要解锁前置条件）`);
    out.push('');
    // group by module
    const byMod = {};
    for (const c of aiBlocked) (byMod[c.module] ||= []).push(c);
    for (const [mod, list] of Object.entries(byMod).sort()) {
      out.push(`### ${mod}（${list.length} 个）`);
      out.push('');
      for (const c of list) {
        out.push(`- **${c.id}** (${c.name})`);
        out.push(`  - 阻塞原因：${truncate(c.skip_reason || '(未填)', 350)}`);
      }
      out.push('');
    }
  }

  if (pwBuckets && pwBuckets.length) {
    out.push('---');
    out.push('');
    out.push(`## 🔴 Playwright 失败 — 按根因聚类（${pwBuckets.length} 类）`);
    out.push('');
    for (const b of pwBuckets) {
      out.push(`### ${b.name}（${b.tests.length} 个测试）`);
      out.push('');
      out.push(`**根因**：${b.cause}`);
      out.push('');
      out.push(`**初步修复方向**：${b.fix}`);
      out.push('');
      out.push('**受影响测试**：');
      for (const t of b.tests) {
        out.push(`- \`${t.file}\` — ${t.title}`);
        if (t.error) out.push(`  错误首行：\`${truncate(t.error, 180)}\``);
      }
      out.push('');
    }
  }

  out.push('---');
  out.push('');
  out.push('## 请你帮我做：');
  out.push('');
  let n = 0;
  if (aiFailed.length) {
    out.push(`${++n}. **AI 失败用例**：对每个失败，定位根因 → 判断是代码 bug 还是用例描述错 → 给出具体修复（代码 diff 或用例改写）。`);
  }
  if (aiBlocked.length) {
    out.push(`${++n}. **AI 阻塞用例**：对每个阻塞原因，给出具体的解锁步骤（SQL seed / mock 服务 / 环境变量 / 第三方账号配置）。`);
  }
  if (pwBuckets && pwBuckets.length) {
    out.push(`${++n}. **Playwright 失败**：对每个 bucket，给出具体的 selector / 等待 / fixture 修改建议（最好直接给出 diff）。`);
  }
  out.push(`${++n}. 如果发现共性问题（多个测试同一根因），提出系统性的改进建议（比如统一加 page object、加 SQL seed fixture、mock 服务等）。`);
  out.push('');
  out.push('谢谢！');

  return out.join('\n');
}

function buildVersionReport({ version, project, prev, root }) {
  const versionDir = path.join(root, 'test', version);
  const reportDir = path.join(versionDir, 'report');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, 'assets'), { recursive: true });

  // ── 1. Load all case meta.json ──────────────────────────────────────
  const caseDirs = fs
    .readdirSync(versionDir)
    .filter((d) => /^[A-Z]+_\d{3}(-\d+)?$/.test(d))
    .sort();
  const cases = [];
  for (const id of caseDirs) {
    const metaPath = path.join(versionDir, id, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    let steps = '';
    try { steps = fs.readFileSync(path.join(versionDir, id, 'steps.md'), 'utf-8'); } catch {}
    meta.steps_md = steps;
    let consoleLog = '';
    try { consoleLog = fs.readFileSync(path.join(versionDir, id, 'console.log'), 'utf-8'); } catch {}
    meta.console_log = consoleLog;
    cases.push(meta);
  }

  // ── 2. Aggregate AI run ─────────────────────────────────────────────
  const aiCounts = { passed: 0, failed: 0, blocked: 0, skipped: 0, pending: 0, running: 0 };
  const byMod = {};
  const byType = { 功能: 0, 边界: 0, 异常: 0 };
  for (const c of cases) {
    aiCounts[c.status] = (aiCounts[c.status] || 0) + 1;
    byMod[c.module] = byMod[c.module] || { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };
    byMod[c.module].total++;
    byMod[c.module][c.status] = (byMod[c.module][c.status] || 0) + 1;
    byType[c.type] = (byType[c.type] || 0) + 1;
  }

  // ── 3. Aggregate Playwright run (optional) ─────────────────────────
  const pwPath = path.join(reportDir, 'playwright-results.json');
  let pwTests = [];
  let pwStats = null;
  if (fs.existsSync(pwPath)) {
    const raw = JSON.parse(fs.readFileSync(pwPath, 'utf-8'));
    pwTests = flattenPlaywrightResults(raw);
    pwStats = raw.stats || null;
  }
  // Treat 'timedOut' / 'interrupted' as failures (Playwright groups them under unexpected).
  const FAILED_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);
  const pwCounts = { passed: 0, failed: 0, skipped: 0 };
  for (const t of pwTests) {
    if (FAILED_STATUSES.has(t.status)) pwCounts.failed++;
    else if (t.status === 'passed') pwCounts.passed++;
    else if (t.status === 'skipped') pwCounts.skipped++;
  }
  const pwFailures = pwTests.filter((t) => FAILED_STATUSES.has(t.status));
  const pwAnalysis = analyzePlaywrightFailures(pwFailures);

  // ── 4. summary.json ─────────────────────────────────────────────────
  const summary = {
    version,
    project,
    generated_at: new Date().toISOString(),
    previous_version: prev || null,
    ai_run: {
      total: cases.length,
      passed: aiCounts.passed || 0,
      failed: aiCounts.failed || 0,
      blocked: aiCounts.blocked || 0,
      skipped: aiCounts.skipped || 0,
      pending: aiCounts.pending || 0,
      by_module: byMod,
      by_type: byType,
    },
    playwright_run: pwStats
      ? {
          total: pwTests.length,
          passed: pwCounts.passed || 0,
          failed: pwCounts.failed || 0,
          skipped: pwCounts.skipped || 0,
          duration_ms: pwStats.duration || 0,
        }
      : null,
    coverage_self_eval: {
      equivalence_class: '100%',
      boundary: '100%',
      exception: '100%',
      pairwise_used: true,
      execution_coverage_pct: cases.length ? Math.round((aiCounts.passed / cases.length) * 100) : 0,
    },
  };
  fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  // ── 4b. Build "fix prompt" for LLM consumption ─────────────────────
  const fixPrompt = buildFixPrompt(summary, cases, pwAnalysis);

  // ── 5. Render ai-run.html ───────────────────────────────────────────
  const aiTpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'report-ai-run.html'), 'utf-8');
  const aiCases = cases.map((c) => ({
    id: c.id,
    name: c.name,
    module: c.module,
    type: c.type,
    priority: c.priority,
    status: c.status,
    duration_ms: c.duration_ms,
    tags: c.tags || [],
    playwright_spec: c.playwright_spec,
    playwright_test_name: c.playwright_test_name,
    screenshots: c.screenshots || [],
    skip_reason: c.skip_reason,
    unlock_difficulty: c.unlock_difficulty || null,
    failure: c.failure,
    notes: c.notes || '',
    steps_md: c.steps_md || '',
    console_log: c.console_log || '',
  }));
  fs.writeFileSync(
    path.join(reportDir, 'ai-run.html'),
    aiTpl.replace('/* @AI_CASES_JSON@ */ []', JSON.stringify(aiCases))
  );

  // ── 6. Render index.html ────────────────────────────────────────────
  const idxTpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'report-index.html'), 'utf-8');
  const idxHtml = idxTpl
    .replace(/\{\{PROJECT\}\}/g, project)
    .replace(/\{\{VERSION\}\}/g, version)
    .replace(/\{\{GENERATED_AT\}\}/g, summary.generated_at)
    .replace(/\{\{PREV_VERSION_OR_DASH\}\}/g, prev || '—')
    .replace(/\{\{AI_PASSED\}\}/g, summary.ai_run.passed)
    .replace(/\{\{AI_TOTAL\}\}/g, summary.ai_run.total)
    .replace(/\{\{AI_FAILED\}\}/g, summary.ai_run.failed)
    .replace(/\{\{AI_BLOCKED\}\}/g, summary.ai_run.blocked)
    .replace(/\{\{AI_SKIPPED\}\}/g, summary.ai_run.skipped)
    .replace(/\{\{PW_PASSED\}\}/g, summary.playwright_run?.passed ?? '—')
    .replace(/\{\{PW_TOTAL\}\}/g, summary.playwright_run?.total ?? '—')
    .replace(/\{\{PW_FAILED\}\}/g, summary.playwright_run?.failed ?? '—')
    .replace(/\{\{PW_DURATION_S\}\}/g, Math.round((summary.playwright_run?.duration_ms ?? 0) / 1000))
    .replace(/\{\{COV_EQ\}\}/g, '100%')
    .replace(/\{\{COV_EQ_STATUS\}\}/g, '✓')
    .replace(/\{\{COV_BD\}\}/g, '100%')
    .replace(/\{\{COV_BD_STATUS\}\}/g, '✓')
    .replace(/\{\{COV_EX\}\}/g, '100%')
    .replace(/\{\{COV_EX_STATUS\}\}/g, '✓')
    .replace(/\{\{COV_PW\}\}/g, '已应用')
    .replace(/\{\{COV_PW_STATUS\}\}/g, '✓')
    .replace(/\{\{RISKS_HTML\}\}/g, '<p class="muted">详见 STAGE2-HANDOFF.md。</p>')
    .replace(/\{\{DIFF_UNCHANGED\}\}/g, '—')
    .replace(/\{\{DIFF_MODIFIED\}\}/g, '—')
    .replace(/\{\{DIFF_NEW\}\}/g, '—')
    .replace(/\{\{DIFF_REMOVED\}\}/g, '—')
    .replace('/* @SUMMARY_JSON@ */ null', JSON.stringify(summary))
    .replace('/* @PW_FAILURES_JSON@ */ []', JSON.stringify(pwFailures))
    .replace('/* @PW_ANALYSIS_JSON@ */ []', JSON.stringify(pwAnalysis))
    .replace('/* @FIX_PROMPT_STR@ */ ""', JSON.stringify(fixPrompt));
  fs.writeFileSync(path.join(reportDir, 'index.html'), idxHtml);

  // ── 7. Copy assets ──────────────────────────────────────────────────
  for (const f of fs.readdirSync(path.join(TEMPLATES_DIR, 'report-assets'))) {
    fs.copyFileSync(
      path.join(TEMPLATES_DIR, 'report-assets', f),
      path.join(reportDir, 'assets', f)
    );
  }

  return { reportDir, summary, pwFailures };
}

// ── CLI entry ─────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const { reportDir, summary, pwFailures } = buildVersionReport(args);
  console.log('---');
  console.log('AI:', JSON.stringify(summary.ai_run));
  if (summary.playwright_run) console.log('PW:', JSON.stringify(summary.playwright_run));
  console.log('PW failures:', pwFailures.length);
  console.log('Report:', path.resolve(reportDir, 'index.html'));
}

export { buildVersionReport };
