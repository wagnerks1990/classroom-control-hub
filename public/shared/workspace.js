/* Classroom Hub task-focused operator workspace. No device commands or API writes. */
(function (root, factory) {
  'use strict';
  const workspace = factory();
  if (typeof module === 'object' && module.exports) module.exports = workspace;
  if (root && root.document) {
    root.ControlHubWorkspace = workspace;
    workspace.boot(root);
  }
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const GROUPS = Object.freeze([
    { id: 'today', label: 'Today', mark: '01' },
    { id: 'teach', label: 'Teach', mark: '02' },
    { id: 'room', label: 'Room', mark: '03' },
    { id: 'library', label: 'Library', mark: '04' },
    { id: 'plan', label: 'Plan', mark: '05' },
    { id: 'admin', label: 'Admin', mark: '06' }
  ].map(Object.freeze));
  const ROUTES = Object.freeze([
    { id: 'overview', group: 'today', label: 'Classroom today', description: 'Your class, screens, and everyday teaching tools in one place.', terms: 'home overview dashboard status' },
    { id: 'display', group: 'teach', label: 'Screen content', description: 'Choose screens, prepare content, then send it when you are ready.', terms: 'display text timer timers scenes countdown announcement message website' },
    { id: 'presentations', group: 'teach', label: 'Presentations', description: 'Choose a deck and screens, then run your presentation.', terms: 'powerpoint slides deck presenter' },
    { id: 'lab', group: 'teach', label: 'Classroom computers', description: 'Monitor classroom computers with Veyon or the Windows agent.', terms: 'lab students veyon windows agent monitoring' },
    { id: 'av', group: 'room', label: 'Screens & AV', description: 'Route sources and manage the power of your room displays.', terms: 'pluto hdmi routing television tv power matrix' },
    { id: 'lights', group: 'room', label: 'Lighting', description: 'Adjust classroom lights without leaving your workspace.', terms: 'govee light lights brightness colour color mqtt' },
    { id: 'music', group: 'room', label: 'Music', description: 'Control classroom audio, favorites, and the background music schedule.', terms: 'audio volume sound assistant playback' },
    { id: 'media', group: 'library', label: 'Media library', description: 'Keep the images, videos, and documents you use for teaching together.', terms: 'files upload image video pdf document' },
    { id: 'classes', group: 'plan', label: 'Classes & schedule', description: 'Organize classes, school days, and the teaching timetable.', terms: 'calendar periods cycle timetable' },
    { id: 'schedules', group: 'plan', label: 'Automations', description: 'Decide what should happen, when it runs, and which devices it affects.', terms: 'automation rules triggers routines schedule' },
    { id: 'settings', group: 'admin', label: 'Settings', description: 'Configure the classroom, integrations, accounts, and access.', terms: 'users profiles permissions credentials setup branding privacy configuration' },
    { id: 'diagnostics', group: 'admin', label: 'Diagnostics', description: 'Investigate connection problems and review system activity.', terms: 'errors logs health troubleshoot services' },
    { id: 'system', group: 'admin', label: 'System & recovery', description: 'Manage updates, services, backups, and recovery deliberately.', terms: 'infrastructure docker containers host update restore backup backups maintenance' }
  ].map(Object.freeze));
  const DISPLAY_WORK = Object.freeze(['display', 'timer', 'media', 'lighting', 'av', 'scenes', 'settings', 'diagnostics']);
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function search(query, allowed = ROUTES.map(route => route.id)) {
    const ids = new Set(allowed), words = normalize(query).split(/\s+/).filter(Boolean);
    return ROUTES.filter(route => ids.has(route.id) && words.every(word => normalize(`${route.label} ${route.group} ${route.terms}`).includes(word)));
  }
  function parseRoute(hash) {
    const match = /^#\/([a-z]+)(?:\/([a-z]+))?$/.exec(String(hash || ''));
    if (!match || !ROUTES.some(route => route.id === match[1])) return null;
    if (match[2] && (match[1] !== 'display' || !DISPLAY_WORK.includes(match[2]))) return null;
    return { page: match[1], work: match[2] || '' };
  }
  function supports(path) {
    return /^\/controller\/(?:index|display|lab|veyon)\.html$/.test(path) || /^\/(?:controller|setup)\/?$/.test(path) || path === '/setup/index.html';
  }
  function classic(win) {
    try {
      if (new URLSearchParams(win.location.search).get('workspace') === 'classic') return true;
      return win.parent !== win && new URLSearchParams(win.parent.location.search).get('workspace') === 'classic';
    } catch { return false; }
  }
  function boot(win) {
    if (!supports(win.location.pathname) || classic(win)) return;
    const ready = () => {
      if (win.document.getElementById('hub-workspace-style')) return;
      const style = win.document.createElement('link');
      style.id = 'hub-workspace-style'; style.rel = 'stylesheet'; style.href = '/shared/workspace.css';
      style.addEventListener('load', () => init(win), { once: true });
      win.document.head.append(style); // A failed stylesheet leaves the existing interface usable.
    };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
  }
  function init(win) {
    const doc = win.document;
    if (doc.documentElement.classList.contains('hub-ui') || !supports(win.location.pathname) || classic(win)) return;
    const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
    const button = (text, handler, cls = '') => { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', handler); return node; };
    const store = { get(key) { try { return win.localStorage.getItem(key); } catch { return null; } }, set(key, value) { try { win.localStorage.setItem(key, value); } catch { /* Preferences are optional. */ } } };
    doc.documentElement.classList.add('hub-ui');
    doc.documentElement.dataset.hubDensity = store.get('hub.workspace.density') === 'compact' ? 'compact' : 'comfortable';
    // Preserve every original form node, stable ID, inline handler, and access-control attribute.
    function fold(panel, label, open = false) {
      if (!panel || panel.closest('.hub-fold') || panel.tagName === 'DETAILS') return null;
      const details = el('details', 'hub-fold'); details.open = open;
      details.append(el('summary', '', label)); panel.before(details); details.append(panel);
      details.addEventListener('toggle', () => { if (details.open) win.dispatchEvent(new win.Event('resize')); });
      return details;
    }
    function consoleWorkspace() {
      const wrap = doc.querySelector('.wrap');
      if (wrap && win.top === win) {
        const back = el('a', 'hub-back', '← Classroom Hub'); back.href = '/controller/'; wrap.prepend(back);
      }
      if (!win.location.pathname.endsWith('/display.html')) return;
      const targets = doc.getElementById('targets')?.closest('.panel');
      if (targets?.querySelector('h2')) targets.querySelector('h2').textContent = '1. Choose screens';
      const tabs = doc.querySelector('.main .nav'), editor = tabs?.closest('.panel');
      const preview = doc.querySelector('.previewPanel');
      if (editor && preview) {
        preview.before(editor);
        editor.prepend(el('h2', 'hub-editor-heading', '2. Prepare your content'));
        const selected = doc.getElementById('targetSelectionSummary');
        if (selected) {
          const context = el('p', 'hub-target-context'); context.setAttribute('role', 'status');
          editor.querySelector('.hub-editor-heading').after(context);
          const update = () => { context.textContent = selected.textContent; };
          new win.MutationObserver(update).observe(selected, { childList: true, subtree: true, characterData: true }); update();
        }
        fold(preview, 'Live preview — check what is on screen', false);
      }
      if (tabs) {
        tabs.setAttribute('aria-label', 'Content tools');
        const advanced = el('details', 'hub-more'); advanced.append(el('summary', '', 'More tools'));
        const content = el('div', 'hub-more-content'); advanced.append(content);
        for (const item of tabs.querySelectorAll('button[data-work]')) {
          if (['lighting', 'av', 'settings', 'diagnostics'].includes(item.dataset.work)) content.append(item);
        }
        if (content.childElementCount) tabs.append(advanced);
        const sync = () => {
          const active = content.querySelector('button.active'); if (active) advanced.open = true;
          for (const item of tabs.querySelectorAll('button[data-work]')) item.setAttribute('aria-pressed', String(item.classList.contains('active')));
        };
        const observer = new win.MutationObserver(sync);
        tabs.querySelectorAll('button[data-work]').forEach(item => observer.observe(item, { attributes: true, attributeFilter: ['class'] })); sync();
      }
      const appearance = ['titleColor', 'subtitleColor', 'titleSize', 'subtitleSize'].map(id => doc.getElementById(id)?.parentElement).filter(Boolean);
      if (appearance.length === 4) {
        const details = el('details', 'hub-fold hub-appearance'); details.append(el('summary', '', 'Text appearance'));
        const fields = el('div', 'grid2'); details.append(fields); appearance[0].parentElement.after(details); fields.append(...appearance);
      }
    }
    const app = doc.querySelector('.app'), side = app?.querySelector(':scope > aside'), main = app?.querySelector(':scope > main');
    const nav = side?.querySelector('nav');
    if (!side || !main || !nav || typeof win.showPage !== 'function') { consoleWorkspace(); return; }
    side.classList.add('hub-sidebar'); main.classList.add('hub-main');
    const originals = new Map(Array.from(nav.querySelectorAll('button[data-page]'), node => [node.dataset.page, node]));
    const pages = new Map(ROUTES.map(route => [route.id, doc.getElementById(route.id)]));
    let current = '', pending = parseRoute(win.location.hash), scheduled = false, searchOpener = null;
    const remembered = new Map();
    const allowed = id => Boolean(win.AUTH_STATUS?.user && pages.get(id) && pages.get(id).dataset.authorized !== 'false' && originals.get(id) && !originals.get(id).hidden);
    const available = () => ROUTES.filter(route => allowed(route.id)).map(route => route.id);
    const title = el('span', 'hub-area-label', 'Classroom workspace');
    const header = el('header', 'hub-workspace-bar'); header.append(title);
    const tools = el('div', 'hub-workspace-tools');
    const searchButton = button('Find a tool', openSearch, 'hub-search-trigger'); searchButton.setAttribute('aria-keyshortcuts', 'Control+k Meta+k');
    const density = button('Compact view', () => {
      const compact = doc.documentElement.dataset.hubDensity !== 'compact';
      doc.documentElement.dataset.hubDensity = compact ? 'compact' : 'comfortable'; store.set('hub.workspace.density', compact ? 'compact' : 'comfortable');
      density.setAttribute('aria-pressed', String(compact)); win.dispatchEvent(new win.Event('resize'));
    }, 'hub-density'); density.setAttribute('aria-pressed', String(doc.documentElement.dataset.hubDensity === 'compact'));
    tools.append(searchButton, density); header.append(tools);
    nav.classList.add('hub-context-nav'); nav.setAttribute('aria-label', 'Tools in this workspace');
    nav.querySelectorAll('.navSection,.navHint').forEach(node => node.remove());
    main.prepend(header, nav);
    const primary = el('nav', 'hub-primary-nav'); primary.id = 'hub-primary-nav'; primary.setAttribute('aria-label', 'Classroom workspaces');
    const groupLinks = new Map();
    for (const group of GROUPS) {
      const link = el('a', 'hub-group'); link.href = `#/${ROUTES.find(route => route.group === group.id).id}`;
      const mark = el('span', 'hub-group-mark', group.mark); mark.setAttribute('aria-hidden', 'true');
      link.append(mark, el('span', '', group.label));
      link.addEventListener('click', event => {
        if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const previous = remembered.get(group.id), target = allowed(previous) ? previous : ROUTES.find(route => route.group === group.id && allowed(route.id))?.id;
        if (target) navigate(target);
      }); groupLinks.set(group.id, link); primary.append(link);
    }
    const menu = button('Workspaces', () => {
      const open = side.classList.toggle('hub-menu-open'); menu.setAttribute('aria-expanded', String(open));
    }, 'hub-mobile-menu'); menu.setAttribute('aria-controls', primary.id); menu.setAttribute('aria-expanded', 'false');
    const account = side.querySelector('#authAccount');
    if (account) account.before(menu, primary); else side.append(menu, primary);
    const recovery = el('a', 'hub-classic-link', 'Use classic layout'); recovery.href = '?workspace=classic'; side.append(recovery);
    const skip = el('a', 'hub-skip', 'Skip to classroom tools'); main.id ||= 'hub-main'; skip.href = `#${main.id}`; main.tabIndex = -1; app.prepend(skip);
    for (const route of ROUTES) {
      const page = pages.get(route.id), item = originals.get(route.id); if (!page || !item) continue;
      item.textContent = route.label; item.type = 'button';
      item.addEventListener('click', () => { if (allowed(route.id) && page.classList.contains('active')) finishNavigation(route.id); });
      const top = page.querySelector(':scope > .top'); const heading = top?.querySelector('h1');
      if (heading) { heading.textContent = route.label; heading.tabIndex = -1; }
      const description = top?.querySelector('.muted'); if (description && !description.id) description.textContent = route.description;
      if (['settings', 'diagnostics', 'system'].includes(route.id)) {
        page.classList.add('hub-admin-page');
        let index = 0;
        for (const panel of page.querySelectorAll('.panel')) {
          if (panel.parentElement.closest('.panel,details') || panel.tagName === 'DETAILS') continue;
          const heading = panel.querySelector('h2'); if (heading) fold(panel, heading.textContent.trim(), index++ === 0);
        }
      }
    }
    const home = pages.get('overview');
    if (home) {
      const launcher = el('section', 'hub-launcher'); launcher.setAttribute('aria-label', 'Start a classroom task');
      launcher.append(el('p', 'hub-eyebrow', 'TEACHING TOOLS'), el('h2', '', 'What would you like to do?'));
      const cards = el('div', 'hub-task-grid'); launcher.append(cards);
      for (const task of [
        ['display', '', 'Put content on screen', 'Messages, websites, and media'],
        ['display', 'timer', 'Start a timer', 'Open the timer controls'],
        ['presentations', '', 'Present a deck', 'Open the presenter console'],
        ['lab', '', 'Check classroom computers', 'Veyon and Windows agent tools']
      ]) {
        const card = button('', () => navigate(task[0], task[1]), 'hub-task'); card.dataset.hubRoute = task[0];
        card.append(el('strong', '', task[2]), el('span', '', task[3]), el('span', 'hub-task-arrow', '→')); cards.append(card);
      }
      const context = home.querySelector(':scope > .grid2'); if (context) context.after(launcher); else home.querySelector('.top')?.after(launcher);
      const connections = doc.getElementById('hubState')?.closest('.grid');
      if (connections && home.contains(connections)) {
        home.append(connections);
        const disclosure = fold(connections, 'Connections & health');
        const status = el('span', 'hub-connection-summary'); disclosure.querySelector('summary').append(status);
        const update = () => { status.textContent = [['hubState', 'Hub'], ['mqttState', 'Lighting'], ['plutoState', 'AV']].map(([id, label]) => `${label}: ${doc.getElementById(id)?.textContent || 'Unknown'}`).join(' · '); };
        new win.MutationObserver(update).observe(connections, { childList: true, subtree: true, characterData: true }); update();
      }
      const power = Array.from(home.querySelectorAll('h2')).find(node => node.textContent.trim() === 'Quick Actions')?.closest('.panel');
      if (power) fold(power, 'Room power & lighting');
      const toolbar = home.querySelector(':scope > .top > .toolbar');
      if (toolbar) {
        const more = el('details', 'hub-more'); more.append(el('summary', '', 'More')); const content = el('div', 'hub-more-content'); more.append(content);
        for (const item of Array.from(toolbar.querySelectorAll(':scope > button'))) {
          if ((item.getAttribute('onclick') || '').startsWith('showPage(')) content.append(item);
          if ((item.getAttribute('onclick') || '') === 'clearClassroom()') item.textContent = 'Clear classroom…';
        }
        if (content.childElementCount) toolbar.append(more);
      }
    }
    const dialog = el('dialog', 'hub-command-dialog'); dialog.setAttribute('aria-labelledby', 'hub-search-title');
    const dialogHead = el('div', 'hub-command-head'); const dialogTitle = el('h2', '', 'Find a classroom tool'); dialogTitle.id = 'hub-search-title';
    const close = button('Close', () => dialog.close()); dialogHead.append(dialogTitle, close);
    const input = el('input', 'hub-command-input'); input.type = 'search'; input.placeholder = 'Try timer, lights, backups…'; input.setAttribute('aria-label', 'Search classroom tools');
    const results = el('ul', 'hub-command-results'); const resultStatus = el('p', 'hub-command-status'); resultStatus.setAttribute('role', 'status');
    dialog.append(dialogHead, input, resultStatus, results); app.append(dialog);
    function renderSearch() {
      results.replaceChildren(); const found = search(input.value, available());
      resultStatus.textContent = found.length ? `${found.length} tool${found.length === 1 ? '' : 's'} available` : 'No matching tools. Try another term.';
      for (const route of found) {
        const row = el('li'); const action = button('', () => { dialog.close(); searchOpener = null; navigate(route.id); }, 'hub-command-result');
        action.append(el('strong', '', route.label), el('span', '', route.description)); row.append(action); results.append(row);
      }
    }
    function openSearch() {
      if (!win.AUTH_STATUS?.user || typeof dialog.showModal !== 'function' || dialog.open) return;
      searchOpener = doc.activeElement; input.value = ''; renderSearch(); dialog.showModal(); input.focus();
    }
    dialog.addEventListener('close', () => { if (searchOpener?.isConnected) searchOpener.focus(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    input.addEventListener('input', renderSearch);
    dialog.addEventListener('keydown', event => {
      const items = Array.from(results.querySelectorAll('button'));
      if (event.key === 'Enter' && doc.activeElement === input) { event.preventDefault(); items[0]?.click(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && items.length) {
        event.preventDefault(); const index = items.indexOf(doc.activeElement), next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index <= 0 ? items.length - 1 : index - 1); items[next].focus();
      }
    });
    doc.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        if ((doc.querySelector('dialog[open]') && !dialog.open) || doc.getElementById('accountModal')?.style.display === 'flex') return;
        event.preventDefault(); openSearch();
      }
      if (event.key === 'Escape' && side.classList.contains('hub-menu-open')) { side.classList.remove('hub-menu-open'); menu.setAttribute('aria-expanded', 'false'); menu.focus(); }
    });
    function selectDisplayWork(work) {
      const frame = pages.get('display')?.querySelector('iframe[data-lazy-src]'); if (!frame || !DISPLAY_WORK.includes(work)) return;
      frame.dataset.hubPendingWork = work;
      const apply = () => {
        try {
          const wanted = frame.dataset.hubPendingWork;
          if (wanted && typeof frame.contentWindow?.showWorkspace === 'function') { frame.contentWindow.showWorkspace(wanted); delete frame.dataset.hubPendingWork; }
        } catch { /* A cross-origin or unavailable frame remains under the existing controller. */ }
      };
      if (!frame.dataset.hubWorkListener) { frame.dataset.hubWorkListener = 'true'; frame.addEventListener('load', apply); }
      apply();
    }
    function finishNavigation(id, work = '', history = true, focus = true) {
      current = id; const route = ROUTES.find(item => item.id === id); if (!route) return;
      remembered.set(route.group, id);
      const hash = `#/${id}${work ? '/' + work : ''}`;
      if (history && win.location.hash !== hash) win.history.pushState(null, '', hash);
      if (work) selectDisplayWork(work);
      side.classList.remove('hub-menu-open'); menu.setAttribute('aria-expanded', 'false');
      sync(); if (focus) pages.get(id)?.querySelector('h1')?.focus({ preventScroll: true });
    }
    function navigate(id, work = '', history = true) {
      if (!allowed(id)) return false;
      // Call the existing router, never duplicate its fetches or authorization logic.
      win.showPage(id);
      if (!pages.get(id)?.classList.contains('active')) return false;
      finishNavigation(id, work, history); return true;
    }
    function sync() {
      if (pending && win.AUTH_STATUS?.user) { const request = pending; pending = null; if (allowed(request.page)) { navigate(request.page, request.work, false); return; } }
      const active = ROUTES.find(route => pages.get(route.id)?.classList.contains('active'));
      if (!active) return;
      if (current && current !== active.id) { finishNavigation(active.id, '', true, false); return; }
      current = active.id; remembered.set(active.group, active.id);
      title.textContent = `${GROUPS.find(group => group.id === active.group).label} / ${active.label}`;
      for (const group of GROUPS) {
        const link = groupLinks.get(group.id); link.hidden = !ROUTES.some(route => route.group === group.id && allowed(route.id));
        if (group.id === active.group) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      }
      for (const route of ROUTES) {
        const item = originals.get(route.id); if (!item) continue;
        item.classList.toggle('hub-context-hidden', route.group !== active.group);
        if (route.id === active.id) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
      }
      doc.querySelectorAll('[data-hub-route]').forEach(item => { item.hidden = !allowed(item.dataset.hubRoute); });
      searchButton.disabled = !win.AUTH_STATUS?.user;
      if (dialog.open) { if (!win.AUTH_STATUS?.user) dialog.close(); else renderSearch(); }
    }
    const schedule = () => { if (!scheduled) { scheduled = true; win.queueMicrotask(() => { scheduled = false; sync(); }); } };
    const observer = new win.MutationObserver(schedule);
    pages.forEach(page => { if (page) observer.observe(page, { attributes: true, attributeFilter: ['class', 'data-authorized'] }); });
    originals.forEach(item => observer.observe(item, { attributes: true, attributeFilter: ['hidden'] }));
    if (account) observer.observe(account, { attributes: true, attributeFilter: ['style'] });
    observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    win.addEventListener('hashchange', () => { const request = parseRoute(win.location.hash) || (!win.location.hash ? { page: 'overview', work: '' } : null); if (request) { if (win.AUTH_STATUS?.user) navigate(request.page, request.work, false); else pending = request; } });
    sync();
    return { navigate, sync, openSearch };
  }
  return Object.freeze({ GROUPS, ROUTES, DISPLAY_WORK, search, parseRoute, supports, classic, boot, init });
});
