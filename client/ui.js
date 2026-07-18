// Migration Assistant client — injected by core via window.BackIssue. Adds a
// "Migrate" entry to the sidebar's System plugin area (admins only), opening a
// self-contained overlay: pick a Mylar3/Kapowarr database (upload or server
// path) → preview the parsed series → import with live progress. The plugin
// owns its overlay (the bridge has no page hook), mirroring the app's drawers.
(function () {
  window.BackIssue.registerClient((api) => {
    if (!api.can('settings.manage')) return; // migration reshapes the library — admins only
    const esc = api.escapeHtml;

    let overlay = null;
    let preview = null;       // { app, series: [{cvId,title,year,monitored,folder,existing}] }
    let picked = new Set();   // cvIds selected for import
    let pollTimer = null;

    const APP_NAMES = { mylar: 'Mylar3', kapowarr: 'Kapowarr' };

    function close() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      overlay?.remove();
      overlay = null; preview = null; picked = new Set();
    }

    function open() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'mig-overlay';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
      });
      overlay.innerHTML = '<div class="mig-panel"><div class="mig-head">' +
        '<b>Migrate a collection</b>' +
        '<button class="mig-x" aria-label="Close">' + api.icon('close') + '</button>' +
        '</div><div class="mig-body" id="mig-body"></div></div>';
      overlay.querySelector('.mig-x').onclick = close;
      document.body.appendChild(overlay);
      renderPicker();
    }

    const body = () => overlay.querySelector('#mig-body');

    // ---- step 1: choose the source database ------------------------------
    function renderPicker(err) {
      body().innerHTML =
        '<p class="mig-note">Import your collection from <b>Mylar3</b> or <b>Kapowarr</b>. Both store ComicVine ids, so every series maps exactly — monitored/paused state carries over, nothing is downloaded automatically, and re-running is safe (already-added series are skipped). Files on disk are picked up by the normal library scan afterwards.</p>' +
        (err ? '<p class="mig-err">' + esc(err) + '</p>' : '') +
        '<div class="mig-card"><b>Upload the database file</b>' +
        '<p class="mig-note">Mylar3: <code>mylar.db</code> · Kapowarr: <code>Kapowarr.db</code> (stop the other app first, or upload a copy).</p>' +
        '<input type="file" id="mig-file" accept=".db,.sqlite,.sqlite3"></div>' +
        '<div class="mig-card"><b>…or a path this server can read</b>' +
        '<p class="mig-note">e.g. a folder mounted into the container.</p>' +
        '<div class="mig-row"><input type="text" id="mig-path" class="mig-input" spellcheck="false" placeholder="/data/mylar.db">' +
        '<button class="btn btn--ghost" id="mig-path-go">Read</button></div></div>';
      body().querySelector('#mig-file').onchange = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        renderBusy('Uploading ' + esc(f.name) + '…');
        try {
          const resp = await fetch('/api/migrate/upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f });
          const j = await resp.json();
          if (!resp.ok) throw new Error(j.error || ('HTTP ' + resp.status));
          gotPreview(j);
        } catch (e2) { renderPicker(String(e2?.message || e2)); }
      };
      body().querySelector('#mig-path-go').onclick = async () => {
        const p = body().querySelector('#mig-path').value.trim();
        if (!p) return;
        renderBusy('Reading…');
        try {
          const j = await api.post('/api/migrate/preview', { path: p });
          if (j.error) throw new Error(j.error);
          gotPreview(j);
        } catch (e2) { renderPicker(String(e2?.message || e2)); }
      };
    }

    function renderBusy(text) { body().innerHTML = '<p class="mig-note">' + text + '</p>'; }

    // ---- step 2: preview + selection -------------------------------------
    function gotPreview(j) {
      preview = j;
      picked = new Set(j.series.filter((s) => !s.existing).map((s) => s.cvId));
      renderPreview();
    }

    async function renderPreview() {
      const s = preview.series;
      const newOnes = s.filter((x) => !x.existing).length;
      let libs = [];
      try { libs = (await api.get('/api/libraries')).libraries || []; } catch { /* older core */ }
      body().innerHTML =
        '<p class="mig-note">Found a <b>' + esc(APP_NAMES[preview.app] || preview.app) + '</b> library: <b>' + s.length + '</b> series (' + newOnes + ' new, ' + (s.length - newOnes) + ' already here).</p>' +
        '<div class="mig-row mig-tools">' +
          '<button class="btn btn--ghost" id="mig-all">Select all new</button>' +
          '<button class="btn btn--ghost" id="mig-none">Select none</button>' +
          (libs.length ? '<label class="mig-lib">into <select id="mig-lib"><option value="">Default library</option>' + libs.map((l) => '<option value="' + l.id + '">' + esc(l.name) + '</option>').join('') + '</select></label>' : '') +
          '<span class="mig-flex"></span>' +
          '<button class="btn" id="mig-run">Import <span id="mig-count">' + picked.size + '</span> series</button>' +
        '</div>' +
        '<div class="mig-list">' + s.map((x) =>
          '<label class="mig-item' + (x.existing ? ' is-existing' : '') + '">' +
          '<input type="checkbox" data-cv="' + x.cvId + '"' + (picked.has(x.cvId) ? ' checked' : '') + '>' +
          '<span class="mig-title">' + esc(x.title) + (x.year ? ' <span class="mig-year">(' + x.year + ')</span>' : '') + '</span>' +
          (x.existing ? '<span class="mig-tag">in library</span>' : '') +
          (!x.monitored ? '<span class="mig-tag mig-tag--dim">paused</span>' : '') +
          '</label>').join('') + '</div>';
      const count = () => { body().querySelector('#mig-count').textContent = picked.size; };
      body().querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.onchange = () => { const id = Number(cb.dataset.cv); if (cb.checked) picked.add(id); else picked.delete(id); count(); };
      });
      body().querySelector('#mig-all').onclick = () => {
        picked = new Set(s.filter((x) => !x.existing).map((x) => x.cvId));
        body().querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = picked.has(Number(cb.dataset.cv)); });
        count();
      };
      body().querySelector('#mig-none').onclick = () => {
        picked = new Set();
        body().querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = false; });
        count();
      };
      body().querySelector('#mig-run').onclick = startImport;
    }

    // ---- step 3: import + progress ---------------------------------------
    async function startImport() {
      if (!picked.size) { api.toast('Nothing selected.', 'info'); return; }
      const items = preview.series.filter((x) => picked.has(x.cvId))
        .map((x) => ({ cvId: x.cvId, title: x.title, monitored: x.monitored }));
      const libraryId = body().querySelector('#mig-lib')?.value || null;
      let r;
      try { r = await api.post('/api/migrate/run', { series: items, libraryId }); }
      catch (e) { r = { error: String(e) }; }
      if (r.error) { api.toast(r.error, 'error'); return; }
      renderProgress();
      pollTimer = setInterval(async () => {
        let p;
        try { p = await api.get('/api/migrate/progress'); } catch { return; }
        renderProgress(p);
        if (p && !p.running && p.finishedAt) { clearInterval(pollTimer); pollTimer = null; renderDone(p); }
      }, 1200);
    }

    function renderProgress(p) {
      const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
      body().innerHTML =
        '<p class="mig-note">Importing… each series is fetched from ComicVine, so a big library takes a while. You can close this — the import keeps running.</p>' +
        '<div class="mig-bar"><div class="mig-fill" style="width:' + pct + '%"></div></div>' +
        '<p class="mig-note">' + (p ? p.done + ' / ' + p.total + (p.current ? ' — ' + esc(p.current) : '') : 'Starting…') + '</p>';
    }

    function renderDone(p) {
      body().innerHTML =
        '<p class="mig-note"><b>Done.</b> ' + p.added + ' added · ' + p.existed + ' already present · ' + p.failed.length + ' failed.</p>' +
        (p.failed.length ? '<div class="mig-list">' + p.failed.map((f) =>
          '<div class="mig-item is-existing"><span class="mig-title">' + esc(f.title || ('volume ' + f.cvId)) + '</span><span class="mig-tag">' + esc(f.error) + '</span></div>').join('') + '</div>' +
          '<p class="mig-note">Failures are usually the ComicVine rate limit — re-run the migration later; imported series are skipped automatically.</p>' : '') +
        '<p class="mig-note">Next: run <b>System → Tools → Scan entire library</b> so files on disk attach to the imported series.</p>';
      api.toast('Migration finished: ' + p.added + ' series added.', 'ok');
    }

    api.addMenuAction('Migrate', open, api.icon('arrow-up'), { section: 'System' });
  });
})();
