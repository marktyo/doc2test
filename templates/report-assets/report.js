(function () {
  // ── Tabs (index.html) ───────────────────────────────────────────────
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

  // Hide diff tab when no previous version
  const diffTab = document.getElementById('diff-tab');
  if (diffTab && window.__SUMMARY__ && !window.__SUMMARY__.previous_version) {
    diffTab.style.display = 'none';
  }

  // Top stat cards: click to filter ai-run iframe by status
  document.querySelectorAll('.cards .card[data-filter]').forEach((c) => {
    c.style.cursor = 'pointer';
    c.title = '点击仅看' + c.dataset.filter;
    c.addEventListener('click', () => {
      const status = c.dataset.filter;
      const aiTab = document.querySelector('.tab[data-tab="ai"]');
      if (aiTab) aiTab.click();
      const iframe = document.querySelector('#panel-ai iframe');
      if (iframe) iframe.contentWindow.postMessage({ type: 'filter-status', status }, '*');
    });
  });

  // Render Playwright failure summary in panel-pw
  const pwFailures = window.__PW_FAILURES__ || [];
  const pwSummary = document.getElementById('pw-summary');
  if (pwSummary) {
    if (!pwFailures.length) {
      pwSummary.innerHTML = '<p class="ok-line">✓ 全部通过 / 跳过，无失败。</p>';
    } else {
      pwSummary.innerHTML = `
        <h3>失败 ${pwFailures.length} 个</h3>
        <ul class="pw-fail-list">
          ${pwFailures.map((f) => `
            <li>
              <code>${escapeHtml(f.file || '')}</code>
              <strong>${escapeHtml(f.title)}</strong>
              <div class="err">${escapeHtml(f.error || '(no error message)')}</div>
            </li>`).join('')}
        </ul>`;
    }
  }

  // ── AI subpage (ai-run.html) ────────────────────────────────────────
  window.AI_REPORT = {
    render() {
      const cases = window.__AI_CASES__ || [];
      const tbody = document.getElementById('case-rows');
      if (!tbody) return;

      // Populate module filter
      const modSel = document.getElementById('filter-module');
      [...new Set(cases.map((c) => c.module))].sort().forEach((m) => {
        const o = document.createElement('option');
        o.value = m; o.textContent = m; modSel.appendChild(o);
      });

      cases.forEach((c) => {
        const tr = document.createElement('tr');
        tr.className = 'case-row row-' + c.status;
        tr.dataset.id = c.id;
        tr.dataset.status = c.status;
        tr.dataset.module = c.module;
        tr.dataset.type = c.type;
        tr.dataset.name = c.name;
        tr.dataset.reason = reasonSummary(c, false);
        const reasonShort = reasonSummary(c, true);
        const reasonFull = reasonSummary(c, false);
        tr.innerHTML = `
          <td><button class="expand" type="button">▸</button></td>
          <td><code>${c.id}</code></td>
          <td>${escapeHtml(c.name)}</td>
          <td>${c.module}</td>
          <td>${c.type}</td>
          <td>${c.priority}</td>
          <td><span class="badge ${c.status}">${c.status}</span></td>
          <td class="reason" title="${escapeHtml(reasonFull)}">${escapeHtml(reasonShort)}</td>
          <td>${formatDuration(c.duration_ms)}</td>
          <td>${c.playwright_spec ? '<span class="pw-mark" title="' + escapeHtml(c.playwright_test_name || '') + '">▶</span>' : '—'}</td>
        `;
        const detail = document.createElement('tr');
        detail.className = 'case-detail';
        detail.hidden = true;
        detail.innerHTML = `<td colspan="10">${renderDetail(c)}</td>`;
        tr.querySelector('.expand').addEventListener('click', (e) => {
          detail.hidden = !detail.hidden;
          e.currentTarget.textContent = detail.hidden ? '▸' : '▾';
        });
        tbody.appendChild(tr);
        tbody.appendChild(detail);
      });

      bindFilters();
      // Listen for parent-frame filter requests
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'filter-status') {
          const sel = document.getElementById('filter-status');
          if (sel) { sel.value = e.data.status; sel.dispatchEvent(new Event('input')); }
        }
      });
      // "Only attention" button
      const attn = document.getElementById('only-attention');
      let attnOn = false;
      attn?.addEventListener('click', () => {
        attnOn = !attnOn;
        attn.classList.toggle('on', attnOn);
        document.querySelectorAll('.case-row').forEach((tr) => {
          const isAttn = tr.dataset.status === 'failed' || tr.dataset.status === 'blocked';
          tr.style.display = !attnOn || isAttn ? '' : 'none';
          tr.nextElementSibling.style.display = tr.style.display;
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
    return short && txt.length > 80 ? txt.slice(0, 80) + '…' : txt;
  }

  function renderDetail(c) {
    const sections = [];
    // 1) 原因/备注（重要的先放上面）
    if (c.skip_reason || c.failure || c.notes) {
      let reasonHtml = '';
      if (c.skip_reason) {
        reasonHtml = `<div class="reason-box ${c.status}"><strong>${c.status === 'blocked' ? '阻塞原因' : '跳过原因'}</strong><p>${escapeHtml(c.skip_reason)}</p></div>`;
      } else if (c.failure) {
        reasonHtml = `<div class="reason-box failed"><strong>失败</strong><p>第 ${c.failure.step} 步 — 预期：${escapeHtml(c.failure.expected)}；实际：${escapeHtml(c.failure.actual)}</p></div>`;
      } else if (c.notes) {
        reasonHtml = `<div class="reason-box info"><strong>备注</strong><p>${escapeHtml(c.notes)}</p></div>`;
      }
      sections.push(reasonHtml);
    }

    // 2) Steps.md (若有)
    if (c.steps_md) {
      sections.push(`<div class="steps"><pre>${escapeHtml(c.steps_md)}</pre></div>`);
    }

    // 3) Screenshots
    if (c.screenshots && c.screenshots.length) {
      sections.push(`
        <div class="screenshots">
          ${c.screenshots.map((s) => `<a href="../${c.id}/screenshots/${s}" target="_blank"><img src="../${c.id}/screenshots/${s}" loading="lazy"/></a>`).join('')}
        </div>`);
    }

    // 4) Playwright link
    if (c.playwright_spec) {
      sections.push(`<p class="pw-link">Playwright spec: <code>${escapeHtml(c.playwright_spec)}</code> — <em>${escapeHtml(c.playwright_test_name || '')}</em></p>`);
    }

    // 5) console.log（若有）
    if (c.console_log) {
      sections.push(`<details><summary>console.log</summary><pre>${escapeHtml(c.console_log)}</pre></details>`);
    }

    return sections.join('') || '<p class="muted">(无更多细节)</p>';
  }

  function bindFilters() {
    const q = document.getElementById('q');
    const mod = document.getElementById('filter-module');
    const typ = document.getElementById('filter-type');
    const st = document.getElementById('filter-status');
    function apply() {
      const qv = (q.value || '').toLowerCase();
      const mv = mod.value, tv = typ.value, sv = st.value;
      document.querySelectorAll('.case-row').forEach((tr) => {
        const hay = (tr.dataset.id + ' ' + tr.dataset.name + ' ' + (tr.dataset.reason || '')).toLowerCase();
        const show =
          (!qv || hay.includes(qv)) &&
          (!mv || tr.dataset.module === mv) &&
          (!tv || tr.dataset.type === tv) &&
          (!sv || tr.dataset.status === sv);
        tr.style.display = show ? '' : 'none';
        tr.nextElementSibling.style.display = show ? '' : 'none';
      });
    }
    [q, mod, typ, st].forEach((el) => el && el.addEventListener('input', apply));
  }

  function formatDuration(ms) {
    if (!ms) return '—';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
