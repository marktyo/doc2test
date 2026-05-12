(function () {
  // Tab 切换（用于 index.html）
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

  // 无上一版本时隐藏 diff tab
  const diffTab = document.getElementById('diff-tab');
  if (diffTab && window.__SUMMARY__ && !window.__SUMMARY__.previous_version) {
    diffTab.style.display = 'none';
  }

  // AI 用例表格渲染器（用于 ai-run.html）
  window.AI_REPORT = {
    render() {
      const cases = window.__AI_CASES__ || [];
      const tbody = document.getElementById('case-rows');
      if (!tbody) return;

      // 填充模块筛选下拉
      const modSel = document.getElementById('filter-module');
      const mods = [...new Set(cases.map((c) => c.module))].sort();
      mods.forEach((m) => {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = m;
        modSel.appendChild(o);
      });

      function row(c) {
        const tr = document.createElement('tr');
        tr.className = 'case-row';
        tr.dataset.id = c.id;
        tr.dataset.status = c.status;
        tr.dataset.module = c.module;
        tr.dataset.type = c.type;
        tr.dataset.name = c.name;
        tr.innerHTML = `
          <td><button class="expand">▸</button></td>
          <td><code>${c.id}</code></td>
          <td>${escapeHtml(c.name)}</td>
          <td>${c.module}</td>
          <td>${c.type}</td>
          <td>${c.priority}</td>
          <td><span class="badge ${c.status}">${c.status}</span></td>
          <td>${formatDuration(c.duration_ms)}</td>
          <td>${c.playwright_spec ? '▶' : '—'}</td>
        `;
        const detail = document.createElement('tr');
        detail.className = 'case-detail';
        detail.hidden = true;
        detail.innerHTML = `
          <td colspan="9">
            <div class="detail-grid">
              <div class="steps"><pre>${escapeHtml(c.steps_md || '(无 steps.md)')}</pre></div>
              <div class="screenshots">
                ${(c.screenshots || [])
                  .map(
                    (s) =>
                      `<a href="../${c.id}/screenshots/${s}" target="_blank"><img src="../${c.id}/screenshots/${s}" loading="lazy"/></a>`
                  )
                  .join('')}
              </div>
            </div>
            ${c.console_log ? `<details><summary>console.log</summary><pre>${escapeHtml(c.console_log)}</pre></details>` : ''}
            ${c.failure ? `<div class="failure"><strong>失败：</strong> 第 ${c.failure.step} 步 — 预期：${escapeHtml(c.failure.expected)}；实际：${escapeHtml(c.failure.actual)}</div>` : ''}
          </td>`;
        tr.querySelector('.expand').addEventListener('click', (e) => {
          detail.hidden = !detail.hidden;
          e.currentTarget.textContent = detail.hidden ? '▸' : '▾';
        });
        tbody.appendChild(tr);
        tbody.appendChild(detail);
      }

      cases.forEach(row);
      bindFilters();
    },
  };

  function bindFilters() {
    const q = document.getElementById('q');
    const mod = document.getElementById('filter-module');
    const typ = document.getElementById('filter-type');
    const st = document.getElementById('filter-status');
    function apply() {
      const qv = (q.value || '').toLowerCase();
      const mv = mod.value, tv = typ.value, sv = st.value;
      document.querySelectorAll('.case-row').forEach((tr) => {
        const hay = (tr.dataset.id + ' ' + tr.dataset.name).toLowerCase();
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
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
