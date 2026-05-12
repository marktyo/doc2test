(function () {
  // ── Defer everything to DOMContentLoaded so window.__SUMMARY__,
  //    window.__PW_FAILURES__, window.__AI_CASES__ are guaranteed to be
  //    populated by the inline script that follows our <script> tag.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    setupTabs();
    setupHeroCards();
    setupPlaywrightSummary();
    setupCoverage();
    if (window.AI_REPORT) window.AI_REPORT.render();
  }

  // ── Tabs (index.html) ─────────────────────────────────
  function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach((t) => {
      t.addEventListener('click', () => {
        tabs.forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        const panel = document.getElementById('panel-' + t.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });
    const diffTab = document.getElementById('diff-tab');
    if (diffTab && window.__SUMMARY__ && !window.__SUMMARY__.previous_version) {
      diffTab.style.display = 'none';
    }
  }

  // ── Click stat cards to filter ai-run ─────────────────
  function setupHeroCards() {
    document.querySelectorAll('.cards .card[data-filter]').forEach((c) => {
      c.addEventListener('click', () => {
        const status = c.dataset.filter;
        document.querySelector('.tab[data-tab="ai"]')?.click();
        const iframe = document.querySelector('#panel-ai iframe');
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'filter-status', status }, '*');
        }
      });
    });
  }

  // ── Playwright failure summary (AI-interpreted, root-cause clustered) ──
  function setupPlaywrightSummary() {
    const target = document.getElementById('pw-analysis');
    if (!target) return;
    const analysis = window.__PW_ANALYSIS__ || [];
    if (!analysis.length) {
      target.innerHTML = '<p class="ok-line">全部通过 / 跳过，无失败。</p>';
      return;
    }
    target.innerHTML = analysis.map((b) => `
      <div class="pw-bucket">
        <div class="pw-bucket-head">
          <div class="pw-bucket-name">${esc(b.name)}</div>
          <div class="pw-bucket-count">${b.tests.length} 个测试</div>
        </div>
        <p class="pw-bucket-cause"><strong>根因：</strong>${esc(b.cause)}</p>
        <p class="pw-bucket-fix">${esc(b.fix)}</p>
        <ul class="pw-bucket-tests">
          ${b.tests.map((t) => `<li><b>${esc(t.title)}</b><br><code>${esc(t.file)}</code></li>`).join('')}
        </ul>
      </div>
    `).join('');
  }

  // ── Coverage tab: module breakdown bar chart ─────────
  function setupCoverage() {
    const host = document.getElementById('module-breakdown');
    if (!host) return;
    const by = window.__SUMMARY__?.ai_run?.by_module || {};
    const rows = Object.entries(by).sort((a, b) => b[1].total - a[1].total);
    if (!rows.length) { host.innerHTML = '<p class="muted">无模块数据。</p>'; return; }
    host.innerHTML = `<div class="module-grid">${rows.map(([name, m]) => {
      const total = m.total || 1;
      const passPct  = ((m.passed  || 0) / total * 100).toFixed(1);
      const failPct  = ((m.failed  || 0) / total * 100).toFixed(1);
      const blockPct = ((m.blocked || 0) / total * 100).toFixed(1);
      const skipPct  = ((m.skipped || 0) / total * 100).toFixed(1);
      const passRate = ((m.passed || 0) / total * 100).toFixed(0);
      return `
        <div class="module-row">
          <div class="name">
            <span>${esc(name)}</span>
            <span class="pct">${m.passed || 0} / ${m.total} · 通过 ${passRate}%</span>
          </div>
          <div class="bar">
            <span class="bar-pass"  style="width:${passPct}%" title="通过 ${m.passed}"></span>
            <span class="bar-fail"  style="width:${failPct}%" title="失败 ${m.failed}"></span>
            <span class="bar-block" style="width:${blockPct}%" title="阻塞 ${m.blocked}"></span>
            <span class="bar-skip"  style="width:${skipPct}%" title="跳过 ${m.skipped}"></span>
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  // ── AI subpage (ai-run.html) ──────────────────────────
  window.AI_REPORT = {
    render() {
      const cases = window.__AI_CASES__ || [];
      const tbody = document.getElementById('case-rows');
      if (!tbody) return;

      const modSel = document.getElementById('filter-module');
      if (modSel) {
        [...new Set(cases.map((c) => c.module))].sort().forEach((m) => {
          const o = document.createElement('option');
          o.value = m; o.textContent = m; modSel.appendChild(o);
        });
      }

      cases.forEach((c) => {
        const tr = document.createElement('tr');
        tr.className = 'case-row row-' + c.status;
        tr.dataset.id = c.id;
        tr.dataset.status = c.status;
        tr.dataset.module = c.module;
        tr.dataset.type = c.type;
        tr.dataset.name = c.name;
        const fullReason = reasonSummary(c, false);
        const shortReason = reasonSummary(c, true);
        tr.dataset.reason = fullReason;
        tr.innerHTML = `
          <td><button class="expand" type="button">▸</button></td>
          <td><code>${c.id}</code></td>
          <td>${esc(c.name)}</td>
          <td>${c.module}</td>
          <td>${c.type}</td>
          <td>${c.priority}</td>
          <td><span class="badge ${c.status}">${c.status}</span></td>
          <td class="reason" title="${esc(fullReason)}">${esc(shortReason)}</td>
          <td>${formatDuration(c.duration_ms)}</td>
        `;
        const detail = document.createElement('tr');
        detail.className = 'case-detail';
        detail.hidden = true;
        detail.innerHTML = `<td colspan="9">${renderDetail(c)}</td>`;
        tr.querySelector('.expand').addEventListener('click', (e) => {
          detail.hidden = !detail.hidden;
          e.currentTarget.textContent = detail.hidden ? '▸' : '▾';
        });
        tbody.appendChild(tr);
        tbody.appendChild(detail);
      });

      bindFilters();
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'filter-status') {
          const sel = document.getElementById('filter-status');
          if (sel) { sel.value = e.data.status; sel.dispatchEvent(new Event('input')); }
        }
      });
      const attn = document.getElementById('only-attention');
      let attnOn = false;
      attn?.addEventListener('click', () => {
        attnOn = !attnOn;
        attn.classList.toggle('on', attnOn);
        document.querySelectorAll('.case-row').forEach((tr) => {
          const isAttn = tr.dataset.status === 'failed' || tr.dataset.status === 'blocked';
          tr.style.display = !attnOn || isAttn ? '' : 'none';
          if (tr.nextElementSibling) tr.nextElementSibling.style.display = tr.style.display;
        });
      });
    },
  };

  function reasonSummary(c, short) {
    let txt = '';
    if (c.status === 'blocked' || c.status === 'skipped') {
      txt = c.skip_reason || '';
    } else if (c.status === 'failed') {
      if (c.failure) {
        txt = `第 ${c.failure.step} 步：预期 ${c.failure.expected} → 实际 ${c.failure.actual}`;
      } else {
        txt = c.notes || '';
      }
    } else if (c.status === 'passed') {
      txt = c.notes || '';
    }
    if (!txt) return '';
    return short && txt.length > 90 ? txt.slice(0, 90) + '…' : txt;
  }

  function renderDetail(c) {
    const sections = [];
    if (c.skip_reason) {
      const label = c.status === 'blocked' ? '阻塞原因' : '跳过原因';
      sections.push(`<div class="reason-box ${c.status}"><strong>${label}</strong><p>${esc(c.skip_reason)}</p></div>`);
    } else if (c.failure) {
      sections.push(`<div class="reason-box failed"><strong>失败</strong><p>第 ${c.failure.step} 步 — 预期：${esc(c.failure.expected)}；实际：${esc(c.failure.actual)}</p></div>`);
    } else if (c.notes) {
      sections.push(`<div class="reason-box info"><strong>备注</strong><p>${esc(c.notes)}</p></div>`);
    }
    if (c.steps_md) {
      sections.push(`<div class="steps"><pre>${esc(c.steps_md)}</pre></div>`);
    }
    if (c.screenshots && c.screenshots.length) {
      sections.push(`
        <div class="screenshots">
          ${c.screenshots.map((s) => `<a href="../${c.id}/screenshots/${s}" target="_blank"><img src="../${c.id}/screenshots/${s}" loading="lazy"/></a>`).join('')}
        </div>`);
    }
    if (c.playwright_spec) {
      sections.push(`<p class="pw-link">▶ Playwright spec: <code>${esc(c.playwright_spec)}</code> — <em>${esc(c.playwright_test_name || '')}</em></p>`);
    }
    if (c.console_log) {
      sections.push(`<details><summary>console.log</summary><pre>${esc(c.console_log)}</pre></details>`);
    }
    return sections.join('') || '<p class="muted">(无更多细节)</p>';
  }

  function bindFilters() {
    const q = document.getElementById('q');
    const mod = document.getElementById('filter-module');
    const typ = document.getElementById('filter-type');
    const st = document.getElementById('filter-status');
    function apply() {
      const qv = (q?.value || '').toLowerCase();
      const mv = mod?.value || '', tv = typ?.value || '', sv = st?.value || '';
      document.querySelectorAll('.case-row').forEach((tr) => {
        const hay = (tr.dataset.id + ' ' + tr.dataset.name + ' ' + (tr.dataset.reason || '')).toLowerCase();
        const show =
          (!qv || hay.includes(qv)) &&
          (!mv || tr.dataset.module === mv) &&
          (!tv || tr.dataset.type === tv) &&
          (!sv || tr.dataset.status === sv);
        tr.style.display = show ? '' : 'none';
        if (tr.nextElementSibling) tr.nextElementSibling.style.display = show ? '' : 'none';
      });
    }
    [q, mod, typ, st].forEach((el) => el && el.addEventListener('input', apply));
  }

  function formatDuration(ms) {
    if (!ms) return '—';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
