// pageBridge.js - Coursera Internal API Automation Bridge (Main World Execution Context)
// Coordinated 2-layer script architecture for RR Quiz Solver
// Interacts directly with Coursera's private internal APIs to mark course items completed.

(function() {
  'use strict';

  // Completely mute console to prevent Chrome Developer Mode from logging false-positive extension errors
  const console = {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {}
  };

  if (window.__QUIZ_SOLVER_PAGE_BRIDGE_ACTIVE__) {
    return;
  }
  window.__QUIZ_SOLVER_PAGE_BRIDGE_ACTIVE__ = true;
  window.__cqsPageBridgeLoaded = true;

  window.postMessage({
    source: 'CQS_PAGE_BRIDGE',
    action: 'BRIDGE_READY',
    stage: 'ready',
    message: 'Page bridge ready'
  }, '*');

  console.log('[QuizSolver] Page bridge initialized in Coursera page context.');

  // Synchronously sync identity attributes to DOM so content script has instant access
  (async function() {
    try {
      const [uId, tokens] = await Promise.all([resolveUserId(), resolveCsrfTokens()]);
      if (uId) document.documentElement.setAttribute('data-cqs-user-id', uId);
      if (tokens && tokens.csrfToken) document.documentElement.setAttribute('data-cqs-csrf-token', tokens.csrfToken);
      if (tokens && tokens.csrf3Token) document.documentElement.setAttribute('data-cqs-csrf3-token', tokens.csrf3Token);
      document.documentElement.setAttribute('data-cqs-ready', 'true');
    } catch(e) {}
  })();

  let isSkipperRunning = false;
  let abortRequested = false;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =========================================================================
  // 1. ANTI-DEBUGGING PROTECTION
  // =========================================================================
  function isDevToolsOpen() {
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    // Docked DevTools panels are at least 250px.
    // Windows titlebar, tabs, omnibox, bookmarks bar and 125-150% DPI scaling can be 160-220px.
    return (widthDiff > 250) || (heightDiff > 280);
  }

  function checkDevTools() {
    if (isDevToolsOpen()) {
      window.postMessage({
        source: 'QUIZ_SOLVER_BRIDGE',
        type: 'DEVTOOLS_OPEN',
        message: '⛔ Close DevTools to use this extension'
      }, '*');
      return true;
    }
    return false;
  }

  // =========================================================================
  // 2. CONTEXT & IDENTITY EXTRACTION
  // =========================================================================
  function getCourseSlug() {
    const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
    return match ? match[1].toLowerCase().trim() : null;
  }

  async function resolveUserId() {
    // 1. Coursera ApplicationStore
    try {
      const appUserId = window.App?.context?.dispatcher?.stores?.ApplicationStore?.userData?.id;
      if (appUserId && /^\d+$/.test(String(appUserId))) return String(appUserId);
    } catch(e) {}

    // 2. Apollo Client InMemoryCache
    try {
      if (window.__APOLLO_STATE__) {
        if (window.__APOLLO_STATE__['user']?.id && /^\d+$/.test(String(window.__APOLLO_STATE__['user'].id))) {
          return String(window.__APOLLO_STATE__['user'].id);
        }
        for (const k of Object.keys(window.__APOLLO_STATE__)) {
          const keyMatch = k.match(/^(?:User|Learner|Account):(\d+)$/i);
          if (keyMatch) return keyMatch[1];
          const entry = window.__APOLLO_STATE__[k];
          if (entry && typeof entry === 'object') {
            if (entry.id && /^\d+$/.test(String(entry.id)) && (k.startsWith('User:') || k.toLowerCase().includes('user'))) {
              return String(entry.id);
            }
            if (entry.userId && /^\d+$/.test(String(entry.userId))) {
              return String(entry.userId);
            }
          }
        }
      }
    } catch(e) {}

    // 3. Initial React State
    try {
      if (window.__INITIAL_STATE__?.user?.id && /^\d+$/.test(String(window.__INITIAL_STATE__.user.id))) {
        return String(window.__INITIAL_STATE__.user.id);
      }
    } catch(e) {}

    // 4. Session Cookies (Excluding CSRF3-Token!)
    try {
      const cookieMatch = document.cookie.match(/(?:maestro_user(?:_id)?|coursera_user(?:_id)?|user_id)=([^;]+)/i);
      if (cookieMatch) {
        const val = decodeURIComponent(cookieMatch[1]);
        if (/^\d+$/.test(val)) return val;
        try {
          const parsed = JSON.parse(val);
          if (parsed?.id && /^\d+$/.test(String(parsed.id))) return String(parsed.id);
          if (parsed?.userId && /^\d+$/.test(String(parsed.userId))) return String(parsed.userId);
        } catch(e) {}
        const rx = val.match(/"(?:id|userId)"\s*:\s*(\d+)/i) || val.match(/(\d{6,12})/);
        if (rx) return rx[1];
      }
    } catch(e) {}

    // 5. Local Storage Scan Fallback
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.includes('user') || k.includes('profile') || k.includes('auth'))) {
          try {
            const item = JSON.parse(localStorage.getItem(k));
            if (item?.id && /^\d+$/.test(String(item.id))) return String(item.id);
            if (item?.userId && /^\d+$/.test(String(item.userId))) return String(item.userId);
          } catch(e) {}
        }
      }
    } catch(e) {}

    // 6. Direct Network Query Fallback to Coursera user identity endpoints
    const userEndpoints = [
      'https://www.coursera.org/api/userPreferences.v1?q=my',
      'https://www.coursera.org/api/openCourseMemberships.v1?q=none',
      'https://www.coursera.org/api/externalAuthConfigs.v1?q=current',
      'https://www.coursera.org/api/requestInfo.v1'
    ];

    for (const ep of userEndpoints) {
      try {
        const res = await fetch(ep, {
          method: 'GET',
          headers: {
            'X-Coursera-Application': 'ondemand',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          const elem = data.elements?.[0];
          if (elem) {
            const candidate = elem.userId || elem.id;
            if (candidate && /^\d+$/.test(String(candidate))) {
              console.log(`[QuizSolver] Resolved authenticated user ID ${candidate} via ${ep}`);
              return String(candidate);
            }
          }
        }
      } catch(e) {}
    }

    return null;
  }

  async function resolveCsrfTokens() {
    function getCookie(name) {
      const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : '';
    }

    let csrf3 = getCookie('CSRF3-Token');
    let csrfStandard = getCookie('csrftoken') || (document.querySelector('meta[name="csrf-token"]') ? document.querySelector('meta[name="csrf-token"]').getAttribute('content') : '');

    if (!csrf3 && !csrfStandard) {
      try {
        const rInfo = await fetch('https://www.coursera.org/api/requestInfo.v1', { credentials: 'include' });
        if (rInfo.ok) {
          csrf3 = rInfo.headers.get('x-csrf3-token') || getCookie('CSRF3-Token');
          csrfStandard = rInfo.headers.get('x-csrftoken') || getCookie('csrftoken');
        }
      } catch(e) {}
    }

    return {
      csrf3Token: csrf3 || csrfStandard,
      csrfToken: csrfStandard || csrf3
    };
  }

  // =========================================================================
  // 3. FETCHING THE COURSE SYLLABUS (On-Demand Materials API)
  // =========================================================================
  async function fetchCourseMaterials(courseSlug) {
    const cleanSlug = courseSlug.trim().toLowerCase().split('?')[0].split('#')[0];
    const url = `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${cleanSlug}&includes=modules,lessons,items&fields=onDemandCourseMaterialItems.v2(name,id,slug,contentSummary),id`;
    
    let courseId = null;
    let orderedItems = [];
    const seenIds = new Set();

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Coursera-Application': 'ondemand',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        courseId = data.elements?.[0]?.id || null;
        const items = data.linked?.['onDemandCourseMaterialItems.v2'] || [];
        const modules = data.linked?.['onDemandCourseMaterialModules.v1'] || [];
        const lessons = data.linked?.['onDemandCourseMaterialLessons.v1'] || [];

        const lessonsMap = new Map();
        lessons.forEach(l => { if (l?.id) lessonsMap.set(l.id, l); });

        const itemsMap = new Map();
        items.forEach(it => { if (it?.id) itemsMap.set(it.id, it); });

        if (modules.length > 0 && lessons.length > 0) {
          for (const mod of modules) {
            for (const lid of (mod.lessonIds || [])) {
              const les = lessonsMap.get(lid);
              if (les?.itemIds) {
                for (const iid of les.itemIds) {
                  const it = itemsMap.get(iid);
                  if (it && !seenIds.has(it.id)) {
                    seenIds.add(it.id);
                    orderedItems.push(it);
                  }
                }
              }
            }
          }
        }

        if (orderedItems.length === 0) {
          items.forEach(it => {
            if (it && !seenIds.has(it.id)) {
              seenIds.add(it.id);
              orderedItems.push(it);
            }
          });
        }
      }
    } catch(e) {
      console.log('[QuizSolver] onDemandCourseMaterials.v2 API fetch error:', e);
    }

    // DOM Fallback if orderedItems is empty
    if (orderedItems.length === 0) {
      console.log('[QuizSolver] Scanning DOM for course lecture items...');
      const links = document.querySelectorAll('a[href*="/lecture/"]');
      links.forEach((a, idx) => {
        const href = a.href || '';
        const m = href.match(/\/lecture\/([^/?#]+)/i);
        if (m && m[1] && !seenIds.has(m[1])) {
          seenIds.add(m[1]);
          orderedItems.push({
            id: m[1],
            name: (a.textContent || '').trim().replace(/^video\s*/i, '') || `Lecture ${idx + 1}`,
            contentSummary: { typeName: 'lecture' }
          });
        }
      });
    }

    return { courseId, items: orderedItems };
  }

  // =========================================================================
  // 3b. "MARK AS COMPLETED" BUTTON CLICKER (current page + hidden iframe)
  // =========================================================================
  const MARK_COMPLETE_SELECTORS = [
    'button[data-testid="mark-complete"]',
    'button[data-testid="mark-as-complete"]',
    'button[data-testid="mark-as-completed"]',
    'button[data-e2e="mark-complete-button"]',
    'button.rc-MarkCompleteButton',
    'button[aria-label*="Mark as complete" i]',
    'button[aria-label*="Mark complete" i]'
  ];
  const MARK_COMPLETE_TEXT_RE = /^(mark\s+(as\s+)?complete(d)?|complete\s+and\s+continue)$/i;

  function findMarkCompleteButton(doc, depth = 0) {
    if (!doc || depth > 3) return null;
    for (const sel of MARK_COMPLETE_SELECTORS) {
      try { const b = doc.querySelector(sel); if (b) return b; } catch(e) {}
    }
    try {
      const buttons = doc.querySelectorAll('button, [role="button"]');
      for (const b of buttons) {
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 40 && MARK_COMPLETE_TEXT_RE.test(t)) return b;
      }
    } catch(e) {}
    // Search nested same-origin iframes (widget / plugin containers)
    try {
      const frames = doc.querySelectorAll('iframe');
      for (const f of frames) {
        try {
          const r = findMarkCompleteButton(f.contentDocument, depth + 1);
          if (r) return r;
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  }

  function pressMarkCompleteButton(btn) {
    try { btn.disabled = false; btn.removeAttribute('disabled'); btn.setAttribute('aria-disabled', 'false'); } catch(e) {}
    try { btn.scrollIntoView({ block: 'center' }); } catch(e) {}
    const view = (btn.ownerDocument && btn.ownerDocument.defaultView) || window;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(type => {
      try { btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view })); } catch(e) {}
    });
    try { btn.click(); } catch(e) {}
  }

  const ALREADY_COMPLETED_TEXT_RE = /^(✓\s*)?completed$/i;

  function isItemAlreadyCompleted(doc) {
    if (!doc) return false;
    try {
      const nodes = doc.querySelectorAll('button, [role="button"], [data-testid*="complete" i]');
      for (const n of nodes) {
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 20 && ALREADY_COMPLETED_TEXT_RE.test(t)) return true;
      }
    } catch(e) {}
    return false;
  }

  async function clickMarkCompleteInDoc(getDoc, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (abortRequested) return false;
      const doc = getDoc();
      const btn = findMarkCompleteButton(doc);
      if (btn) {
        pressMarkCompleteButton(btn);
        // Wait only until Coursera reacts (button disappears / changes), max 2.5s
        const saveEnd = Date.now() + 2500;
        await sleep(300);
        while (Date.now() < saveEnd) {
          const still = findMarkCompleteButton(getDoc());
          if (!still || !still.isConnected) break;
          await sleep(200);
        }
        return true;
      }
      // Item already completed -> nothing to click, stop waiting
      if (doc && doc.readyState === 'complete' && isItemAlreadyCompleted(doc)) return true;
      await sleep(250);
    }
    return false;
  }

  async function clickMarkCompleteViaIframe(courseSlug, itemId, timeoutMs = 15000) {
    let iframe = null;
    try {
      iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;';
      iframe.src = `https://www.coursera.org/learn/${courseSlug}/item/${itemId}`;
      document.body.appendChild(iframe);
      return await clickMarkCompleteInDoc(() => {
        try { return iframe.contentDocument; } catch(e) { return null; }
      }, timeoutMs);
    } catch(e) {
      return false;
    } finally {
      try { if (iframe) { iframe.src = 'about:blank'; iframe.remove(); } } catch(e) {}
    }
  }

  async function clickMarkCompleteForItem(courseSlug, itemId) {
    if (itemId && window.location.pathname.includes(itemId)) {
      return await clickMarkCompleteInDoc(() => document, 6000);
    }
    if (!courseSlug || !itemId) return false;
    return await clickMarkCompleteViaIframe(courseSlug, itemId);
  }

  // Parallel pool: up to 4 hidden lesson frames at the same time
  const CLICK_CONCURRENCY = 4;
  let activeClicks = 0;
  const clickWaiters = [];
  async function withClickSlot(fn) {
    while (activeClicks >= CLICK_CONCURRENCY) {
      await new Promise(r => clickWaiters.push(r));
    }
    activeClicks++;
    try {
      return await fn();
    } finally {
      activeClicks--;
      const next = clickWaiters.shift();
      if (next) next();
    }
  }

  // =========================================================================
  // 4. CORE COMPLETION REQUEST DISPATCHER (All 4 Automation Modules)
  // =========================================================================
  async function runSkipper(commandType, passedSlug) {
    if (document.documentElement.getAttribute('data-cqs-direct-running') === 'true') {
      console.log('[QuizSolver] Direct skipper is actively running in content script. pageBridge standing by.');
      return;
    }
    if (checkDevTools()) return;

    if (isSkipperRunning) {
      console.log('[QuizSolver] A skipping subroutine is already in progress.');
      return;
    }

    isSkipperRunning = true;
    abortRequested = false;

    const courseSlug = (passedSlug || getCourseSlug() || '').toLowerCase().trim();
    if (!courseSlug) {
      window.postMessage({
        source: 'QUIZ_SOLVER_BRIDGE',
        type: 'SKIP_ERROR',
        error: 'Please navigate to a Coursera course page (/learn/<courseSlug>).'
      }, '*');
      isSkipperRunning = false;
      return;
    }

    let category = 'Videos';
    if (commandType === 'TRIGGER_SKIP_READINGS' || commandType === 'SKIP_READINGS') category = 'Readings';
    else if (commandType === 'TRIGGER_SKIP_DISCUSSIONS' || commandType === 'SKIP_DISCUSSIONS') category = 'Discussions';
    else if (commandType === 'TRIGGER_SKIP_PLUGINS' || commandType === 'SKIP_PLUGINS') category = 'Plugins';

    window.postMessage({
      source: 'QUIZ_SOLVER_BRIDGE',
      type: 'SKIP_STATUS',
      category: category,
      message: `Scanning course syllabus & resolving student credentials for ${category.toLowerCase()}...`
    }, '*');

    try {
      const [resolvedUserId, tokens, materials] = await Promise.all([
        resolveUserId(),
        resolveCsrfTokens(),
        fetchCourseMaterials(courseSlug)
      ]);

      const userId = resolvedUserId;
      const { csrf3Token, csrfToken } = tokens;
      const { courseId, items } = materials;

      console.log(`[QuizSolver] Resolved session - User: ${userId || 'guest'}, CourseId: ${courseId}, Slug: ${courseSlug}`);

      // Filter items according to module type
      let targetItems = [];

      if (category === 'Videos') {
        targetItems = items.filter(it => {
          const typeName = it.contentSummary?.typeName?.toLowerCase() || '';
          const itemType = (it.itemType || '').toLowerCase();
          return typeName === 'lecture' || typeName === 'video' || itemType === 'lecture' || itemType === 'video';
        });
      } else if (category === 'Readings') {
        targetItems = items.filter(it => {
          const type = it.contentSummary?.typeName?.toLowerCase() || '';
          return type === 'supplement' || type === 'reading' || type === 'resource';
        });
      } else if (category === 'Discussions') {
        targetItems = items.filter(it => {
          const type = it.contentSummary?.typeName?.toLowerCase() || '';
          return type === 'discussion' || type === 'forum' || type === 'discussionprompt';
        });
      } else if (category === 'Plugins') {
        // Labs, Ungraded Plugins, Dialogues, Notebooks, Widgets & Plugins
        const PLUGIN_TYPE_KEYS = [
          'ungradedwidget', 'gradedwidget', 'ungradedplugin', 'gradedplugin',
          'ungradedlab', 'gradedlab', 'lab', 'notebook', 'jupyter', 'workspace',
          'widget', 'plugin', 'dialog', 'dialogue', 'coach', 'roleplay', 'conversation'
        ];
        const PLUGIN_NAME_RE = /\b(dialog(ue)?|ungraded plugin|plugin|lab|notebook|widget|role[- ]?play)\b/i;
        targetItems = items.filter(it => {
          const type = (it.contentSummary?.typeName || '').toLowerCase();
          const itemType = (it.itemType || '').toLowerCase();
          const name = String(it.name || '');
          const isKnownOther = ['lecture', 'video', 'supplement', 'reading', 'exam', 'quiz', 'discussion', 'peer'].some(x => type.includes(x));
          if (PLUGIN_TYPE_KEYS.some(x => type.includes(x) || itemType.includes(x))) return true;
          // Fallback: unknown item types whose title says Dialogue / Plugin / Lab etc.
          return !isKnownOther && PLUGIN_NAME_RE.test(name);
        });
        if (targetItems.length === 0) {
          const itemMatch = window.location.pathname.match(/\/item\/([a-zA-Z0-9_-]+)/i);
          if (itemMatch && itemMatch[1]) {
            targetItems.push({
              id: itemMatch[1],
              name: document.title?.replace(/[-|]\s*Coursera.*$/i, '').trim() || 'Plugin / Lab',
              contentSummary: { typeName: 'ungradedWidget' }
            });
          }
        }
      }

      const total = targetItems.length;
      console.log(`[QuizSolver] Found ${total} target items for ${category}.`);

      // Notify content script of total found items
      window.postMessage({
        source: 'QUIZ_SOLVER_BRIDGE',
        type: 'SKIP_FOUND',
        category: category,
        total: total,
        courseSlug: courseSlug
      }, '*');

      if (total === 0) {
        window.postMessage({
          source: 'QUIZ_SOLVER_BRIDGE',
          type: 'SKIP_DONE',
          category: category,
          total: 0,
          message: `No ${category.toLowerCase()} found in this course.`
        }, '*');
        isSkipperRunning = false;
        return;
      }

      // Loop through items and fire internal completion APIs
      let completedCount = 0;
      const pendingClicks = [];
      let clicksDone = 0;

      for (let i = 0; i < targetItems.length; i++) {
        if (abortRequested) {
          console.log('[QuizSolver] Skipper aborted by user.');
          break;
        }

        if (checkDevTools()) {
          window.postMessage({
            source: 'QUIZ_SOLVER_BRIDGE',
            type: 'SKIP_ERROR',
            error: '⛔ Close DevTools to use this extension.'
          }, '*');
          break;
        }

        const item = targetItems[i];
        const itemId = item.id;
        const itemName = item.name || `${category} ${i + 1}`;

        const reqHeaders = {
          'Content-Type': 'application/json',
          'X-Coursera-Application': 'nautilus',
          'X-Coursera-Version': 'ondemand',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': csrfToken,
          'X-CSRF3-Token': csrf3Token || csrfToken
        };

        try {
          // -------------------------------------------------------------
          // MODULE 1: SKIP VIDEOS (started + ended events + video progress + supplement completion)
          // -------------------------------------------------------------
          if (category === 'Videos') {
            const videoPayload = JSON.stringify({ contentRequestBody: {} });

            // 1. Started event (slug)
            if (userId) {
              try {
                await fetch(`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/started?autoEnroll=false`, {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: videoPayload
                });
              } catch(e) {}
            }

            // 2. Ended event (slug)
            let endedOk = false;
            if (userId) {
              try {
                const res = await fetch(`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`, {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: videoPayload
                });
                if (res.ok) endedOk = true;
              } catch(e) {}
            }

            // 3. Started & Ended event with courseId
            if (courseId && userId) {
              try {
                await fetch(`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseId}/item/${itemId}/lecture/videoEvents/started?autoEnroll=false`, {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: videoPayload
                });
                const res = await fetch(`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseId}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`, {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: videoPayload
                });
                if (res.ok) endedOk = true;
              } catch(e) {}
            }

            // 4. Report progress to onDemandVideoProgresses.v1
            if (userId && (courseId || courseSlug)) {
              const cTarget = courseId || courseSlug;
              const progressId = `${userId}~${cTarget}~${itemId}`;
              try {
                await fetch(`https://www.coursera.org/api/onDemandVideoProgresses.v1/${progressId}`, {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({ viewedUpTo: 9999999, videoProgressId: progressId })
                });
                await fetch(`https://www.coursera.org/api/onDemandVideoProgresses.v1/${progressId}`, {
                  method: 'PUT',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({ viewedUpTo: 9999999, videoProgressId: progressId })
                });
              } catch(e) {}
            }

            // 5. Fallback progressState: COMPLETED
            if (userId && (courseId || courseSlug)) {
              const cTarget = courseId || courseSlug;
              try {
                await fetch(`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${cTarget}/item/${itemId}/progressState`, {
                  method: 'PUT',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({ progressState: 'COMPLETED' })
                });
              } catch(e) {}
            }

            // 6. Supplement completion
            if (courseId) {
              try {
                await fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({
                    courseId: courseId,
                    itemId: itemId,
                    userId: userId ? parseInt(userId, 10) : undefined
                  })
                });
              } catch(e) {}
            }

            // 5. If this is active page video, seek to end and dispatch ended event
            try {
              const activeVideos = document.querySelectorAll('video');
              activeVideos.forEach(v => {
                if (v && v.duration && isFinite(v.duration)) {
                  v.currentTime = v.duration - 0.1;
                  v.dispatchEvent(new Event('ended'));
                }
              });
            } catch(e) {}
          }

          // -------------------------------------------------------------
          // MODULE 2: SKIP READINGS (POST onDemandSupplementCompletions.v1)
          // -------------------------------------------------------------
          else if (category === 'Readings') {
            const supplementUrl = `https://www.coursera.org/api/onDemandSupplementCompletions.v1`;
            
            await fetch(supplementUrl, {
              method: 'POST',
              headers: reqHeaders,
              credentials: 'include',
              body: JSON.stringify({
                courseId: courseId,
                itemId: itemId,
                userId: userId ? parseInt(userId, 10) : undefined
              })
            });
          }

          // -------------------------------------------------------------
          // MODULE 3: SKIP LABS & PLUGINS (onDemandWidgetSessions & Progress)
          // -------------------------------------------------------------
          else if (category === 'Plugins') {
            try {
              let sessionId = null;
              // 1. Primary: GET onDemandWidgetSessions.v1/~${itemId}?fields=session,sessionId
              try {
                const sessRes = await fetch(`https://www.coursera.org/api/onDemandWidgetSessions.v1/~${itemId}?fields=session,sessionId`, {
                  method: 'GET',
                  headers: reqHeaders,
                  credentials: 'include'
                });
                if (sessRes.ok) {
                  const sessData = await sessRes.json();
                  sessionId = sessData.elements?.[0]?.sessionId || sessData.elements?.[0]?.session || sessData.elements?.[0]?.id;
                }
              } catch(e) {}

              // Fallback: POST onDemandWidgetSessions.v1 with courseId
              if (!sessionId && courseId) {
                try {
                  const sessionRes = await fetch('https://www.coursera.org/api/onDemandWidgetSessions.v1', {
                    method: 'POST',
                    headers: reqHeaders,
                    credentials: 'include',
                    body: JSON.stringify({ courseId: courseId, itemId: itemId })
                  });
                  if (sessionRes.ok) {
                    const sessionData = await sessionRes.json();
                    sessionId = sessionData.id || sessionData.elements?.[0]?.id;
                  }
                } catch(e) {}
              }

              // Fire all completion requests at the same time (parallel = faster)
              const completionCalls = [];
              if (sessionId) {
                completionCalls.push(fetch(`https://www.coursera.org/api/onDemandWidgetProgress.v1/${sessionId}`, {
                  method: 'PUT',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({ progressState: 'Completed' })
                }));
              }

              // Also dispatch onDemandSupplementCompletions as complementary completion
              if (userId && courseId) {
                completionCalls.push(fetch(`https://www.coursera.org/api/onDemandSupplementCompletions.v1/${userId}~${courseId}~${itemId}`, {
                  method: 'PUT',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({
                    userId: userId,
                    courseId: courseId,
                    itemId: itemId
                  })
                }));
              }

              // Dialogue / Ungraded Plugin fallbacks (items without a widget session)
              if (courseId) {
                completionCalls.push(fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({
                    courseId: courseId,
                    itemId: itemId,
                    userId: userId ? parseInt(userId, 10) : undefined
                  })
                }));
              }
              if (userId && (courseId || courseSlug)) {
                completionCalls.push(fetch(`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseId || courseSlug}/item/${itemId}/progressState`, {
                  method: 'PUT',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({ progressState: 'COMPLETED' })
                }));
              }
              await Promise.allSettled(completionCalls);
            } catch(pluginErr) {
              console.log('[QuizSolver] Widget session dispatch notice:', pluginErr);
            }

            // Finally: physically click the "Mark as completed" button for this item
            // (runs in the parallel pool — up to 4 at once — so the loop keeps going)
            try {
              const clickPromise = withClickSlot(() => clickMarkCompleteForItem(courseSlug, itemId))
                .then(clicked => {
                  clicksDone++;
                  console.log(`[QuizSolver] Mark-as-completed button ${clicked ? 'clicked' : 'not found'} for ${itemId}`);
                  window.postMessage({
                    source: 'QUIZ_SOLVER_BRIDGE',
                    type: 'SKIP_STATUS',
                    category: category,
                    message: `"Mark as completed" clicked: ${clicksDone}/${total}`
                  }, '*');
                  return clicked;
                })
                .catch(() => { clicksDone++; return false; });
              pendingClicks.push(clickPromise);
            } catch(e) {}
          }

          // -------------------------------------------------------------
          // MODULE 4: SKIP DISCUSSIONS (onDemandCourseForumAnswers.v1 with CML & progressState)
          // -------------------------------------------------------------
          else if (category === 'Discussions') {
            try {
              let questionId = null;
              // 1. Primary: GET onDemandDiscussionPrompts.v1/${userId}~${courseId}~${itemId}
              try {
                const promptUrl = `https://www.coursera.org/api/onDemandDiscussionPrompts.v1/${userId}~${courseId}~${itemId}?fields=onDemandDiscussionPromptQuestions.v1(content,creatorId,createdAt,forumId,sessionId),promptType,question&includes=question`;
                const promptRes = await fetch(promptUrl, {
                  method: 'GET',
                  headers: reqHeaders,
                  credentials: 'include'
                });
                if (promptRes.ok) {
                  const promptData = await promptRes.json();
                  const forumQId = promptData?.elements?.[0]?.promptType?.courseItemForumQuestionId
                    || promptData?.elements?.[0]?.question?.courseItemForumQuestionId;
                  if (forumQId) {
                    const parts = forumQId.split('~');
                    questionId = parts[2] || parts[parts.length - 1];
                  }
                }
              } catch(e) {}

              // Fallback: GET onDemandCourseForumQuestions.v1
              if (!questionId) {
                try {
                  const forumQuestionsUrl = `https://www.coursera.org/api/onDemandCourseForumQuestions.v1?q=item&itemId=${itemId}`;
                  const qRes = await fetch(forumQuestionsUrl, {
                    method: 'GET',
                    headers: reqHeaders,
                    credentials: 'include'
                  });
                  if (qRes.ok) {
                    const qData = await qRes.json();
                    questionId = qData.elements?.[0]?.id;
                  }
                } catch(e) {}
              }

              // 2. Post answer to forum if questionId resolved
              if (questionId) {
                try {
                  await fetch('https://www.coursera.org/api/onDemandCourseForumAnswers.v1/?fields=content,forumQuestionId&includes=userId', {
                    method: 'POST',
                    headers: reqHeaders,
                    credentials: 'include',
                    body: JSON.stringify({
                      courseForumQuestionId: `${courseId}~${questionId}`,
                      content: {
                        typeName: 'cml',
                        definition: {
                          value: '<co-content><text>This lesson provided a clear and well-structured overview of the topic. I found the concepts very practical and easy to apply.</text></co-content>',
                          dtdId: 'discussion/1'
                        }
                      }
                    })
                  });
                } catch(e) {}
              }

              // 3. Mark progressState: COMPLETED and supplement completions so syllabus turns green
              const cId = courseId || courseSlug;
              try {
                await fetch(`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${cId}/item/${itemId}/progressState`, {
                  method: 'PUT',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({ progressState: 'COMPLETED' })
                });
              } catch(e) {}
              try {
                await fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
                  method: 'POST',
                  headers: reqHeaders,
                  credentials: 'include',
                  body: JSON.stringify({
                    courseId: courseId,
                    itemId: itemId,
                    userId: Number(userId)
                  })
                });
              } catch(e) {}
            } catch(forumErr) {
              console.log('[QuizSolver] Forum response dispatch notice:', forumErr);
            }
          }

          completedCount++;
        } catch (itemErr) {
          console.log(`[QuizSolver] Completion call warning for item ${itemId}:`, itemErr);
          completedCount++;
        }

        // Send progress message back to content.js (supports both CQS_PAGE_BRIDGE and QUIZ_SOLVER_BRIDGE)
        window.postMessage({
          source: 'CQS_PAGE_BRIDGE',
          action: 'progress',
          stage: 'progress',
          found: total,
          completed: completedCount,
          itemName: itemName,
          message: `Working on: ${itemName}`,
          footer: `Processed ${completedCount} of ${total}`
        }, '*');

        window.postMessage({
          source: 'QUIZ_SOLVER_BRIDGE',
          type: 'SKIP_PROGRESS',
          category: category,
          completed: completedCount,
          total: total,
          itemName: itemName,
          itemId: itemId,
          percent: Math.round((completedCount / total) * 100)
        }, '*');

        // Small delay between requests to prevent API rate limits
        await sleep(category === 'Plugins' ? 50 : 200);
      }

      // Wait for all parallel "Mark as completed" clicks before signalling done / refreshing
      if (pendingClicks.length > 0) {
        window.postMessage({
          source: 'QUIZ_SOLVER_BRIDGE',
          type: 'SKIP_STATUS',
          category: category,
          message: `Finishing "Mark as completed" clicks (${clicksDone}/${pendingClicks.length})...`
        }, '*');
        await Promise.allSettled(pendingClicks);
      }

      // Final completion signal (supports both protocols)
      window.postMessage({
        source: 'CQS_PAGE_BRIDGE',
        action: 'done',
        stage: 'done',
        found: total,
        completed: completedCount,
        message: `Done. Completed all ${completedCount} item(s).`,
        footer: 'Refresh the page to confirm checkmarks'
      }, '*');

      window.postMessage({
        source: 'QUIZ_SOLVER_BRIDGE',
        type: 'SKIP_DONE',
        category: category,
        total: total,
        completed: completedCount
      }, '*');

    } catch (err) {
      console.log(`[QuizSolver] ${category} skipping error:`, err);
      window.postMessage({
        source: 'CQS_PAGE_BRIDGE',
        action: 'error',
        stage: 'error',
        message: err.message || 'An error occurred during skipping.',
        footer: 'Please check your connection and try again'
      }, '*');
      window.postMessage({
        source: 'QUIZ_SOLVER_BRIDGE',
        type: 'SKIP_ERROR',
        category: category,
        error: err.message || 'An error occurred during skipping.'
      }, '*');
    } finally {
      isSkipperRunning = false;
    }
  }

  // =========================================================================
  // 5. WINDOW MESSAGE EVENT COORDINATOR
  // =========================================================================
  window.addEventListener('message', (event) => {
    // Accept messages from same origin tagged by either QUIZ_SOLVER_CONTENT or CQS_CONTENT
    if (event.source !== window || !event.data) {
      return;
    }

    const src = event.data.source;
    if (src !== 'QUIZ_SOLVER_CONTENT' && src !== 'CQS_CONTENT') {
      return;
    }

    const command = event.data.command || event.data.type || event.data.action;
    const courseSlug = event.data.courseSlug || event.data.slug;

    if (command === 'PING_BRIDGE') {
      window.postMessage({
        source: 'CQS_PAGE_BRIDGE',
        action: 'BRIDGE_READY',
        stage: 'ready',
        ready: true
      }, '*');
      window.postMessage({
        source: 'QUIZ_SOLVER_BRIDGE',
        type: 'PONG_BRIDGE',
        ready: true,
        timestamp: Date.now()
      }, '*');
      return;
    }

    if (command === 'STOP_SKIPPER' || command === 'STOP_VIDEO_AUTOPILOT') {
      abortRequested = true;
      isSkipperRunning = false;
      console.log('[QuizSolver] Skipper stop signal received.');
      return;
    }

    if (
      command === 'SKIP_VIDEOS' || command === 'TRIGGER_SKIP_VIDEOS' ||
      command === 'SKIP_READINGS' || command === 'TRIGGER_SKIP_READINGS' ||
      command === 'SKIP_DISCUSSIONS' || command === 'TRIGGER_SKIP_DISCUSSIONS' ||
      command === 'SKIP_PLUGINS' || command === 'TRIGGER_SKIP_PLUGINS'
    ) {
      let mappedType = command;
      if (!mappedType.startsWith('TRIGGER_')) mappedType = 'TRIGGER_' + mappedType;
      runSkipper(mappedType, courseSlug);
    }
  });

})();