// ==UserScript==
// @name         资管云课程队列管理助手（分享版）
// @namespace    https://ziguanyun.com/
// @version      1.0.0
// @description  管理课程队列；仅在平台确认课程完成后按队列进入下一门，不修改视频进度
// @match        https://ziguanyun.com/*
// @match        https://www.ziguanyun.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (window.__ZGY_COURSE_MANAGER_100__) return;
  window.__ZGY_COURSE_MANAGER_100__ = true;

  const STORE = 'zgy-course-manager-queue-v1';
  const AUTO = 'zgy-course-manager-auto-next-v1';
  const PATH = /^\\/course\\/(special|detail)\\/(\\d+)\\/?$/;
  const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();

  function route(raw = location.href) {
    try {
      const u = new URL(raw, location.href);
      if (!['ziguanyun.com', 'www.ziguanyun.com'].includes(u.hostname)) return null;
      const m = u.pathname.match(PATH);
      return m ? { type: m[1], id: m[2] } : null;
    } catch { return null; }
  }
  const detailUrl = id => `${location.origin}/course/detail/${id}`;
  function normalize(raw) {
    const r = route(raw);
    return r ? `${location.origin}/course/${r.type}/${r.id}` : null;
  }

  function load() {
    try {
      const old = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (old && Array.isArray(old.queue)) {
        const seen = new Set();
        const queue = old.queue.map(normalize).filter(url => {
          const id = route(url)?.id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        const oldId = route(old.queue[Number(old.index) || 0])?.id;
        const idx = queue.findIndex(url => route(url)?.id === oldId);
        return { queue, index: Math.max(0, idx), running: false };
      }
    } catch (e) { console.warn('[资管云队列] 读取队列失败', e); }
    return { queue: [], index: 0, running: false };
  }

  const state = load();
  let autoNext = localStorage.getItem(AUTO) === 'true';
  let panel, queueInfo, statusInfo, startBtn, autoBtn, modeInfo;
  let lastStatus = '', handledCourse = '';

  function status(s) {
    if (s === lastStatus) return;
    lastStatus = s;
    if (statusInfo) statusInfo.textContent = s;
    console.info('[资管云队列]', s);
  }
  function save() {
    localStorage.setItem(STORE, JSON.stringify({ queue: state.queue, index: state.index }));
    render();
  }
  function render() {
    if (!panel) return;
    queueInfo.textContent = `队列 ${state.queue.length} 门 · 当前 ${state.queue.length ? state.index + 1 : 0}/${state.queue.length}`;
    startBtn.textContent = state.running ? '■ 停止任务' : '▶ 开始任务';
    autoBtn.textContent = autoNext ? '跨课程联播：开' : '跨课程联播：关';
    autoBtn.style.background = autoNext ? '#e8f6ed' : '#f5f5f5';
    autoBtn.style.borderColor = autoNext ? '#59b778' : '#ddd';
    modeInfo.textContent = autoNext
      ? '平台确认本门完成后，自动进入下一门'
      : '本门完成后停止自动切换';
  }
  function addCourses(urls) {
    let n = 0;
    for (const raw of urls) {
      const url = normalize(raw), id = route(url)?.id;
      if (id && !state.queue.some(x => route(x)?.id === id)) {
        state.queue.push(url); n++;
      }
    }
    save();
    status(`新增 ${n} 门课程，队列共 ${state.queue.length} 门`);
  }
  function scanPage() {
    const urls = [...document.querySelectorAll('a[href], [data-href], [data-url]')]
      .map(el => el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-url'))
      .filter(Boolean);
    addCourses(urls);
  }
  function toggleAuto() {
    autoNext = !autoNext;
    localStorage.setItem(AUTO, String(autoNext));
    render();
    status(autoNext ? '已开启跨课程联播' : '已关闭跨课程联播');
  }

  // 仅读取平台公开显示的完成状态，不修改播放进度或学习记录。
  function platformCompleted() {
    const text = clean(document.body?.innerText).replace(/\\s/g, '');
    const m = text.match(/本课程已学习(\\d+)节[\\/／]?共(\\d+)节/);
    if (m && Number(m[2]) > 0 && Number(m[1]) >= Number(m[2])) return true;
    if (/本课程已学100(?:\\.0+)?%/.test(text)) return true;

    return [...document.querySelectorAll('body *')].some(el => {
      if (!el.getClientRects().length) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const t = clean(el.innerText || el.textContent);
      return t.includes('课程已学完') &&
        (t.includes('请为本课程推荐打分') ||
         t.includes('又完成了一门课程学习') ||
         t.includes('继续加油'));
    });
  }

  function stop(message = '任务已停止') {
    state.running = false;
    save();
    status(message);
  }
  function nextCourse() {
    if (!state.running) return;
    state.index++;
    if (state.index >= state.queue.length) {
      state.running = false;
      save();
      status('队列中的课程已全部处理完毕');
      return;
    }
    const target = route(state.queue[state.index]);
    save();
    if (!target) return stop('下一门课程链接无效');
    handledCourse = '';
    status(`正在进入队列第 ${state.index + 1} 门课程`);
    location.assign(detailUrl(target.id));
  }
  function onCompleted() {
    const current = route();
    if (!current || handledCourse === current.id) return;
    handledCourse = current.id;
    if (autoNext) {
      status('平台已确认本门课程完成，进入下一门');
      nextCourse();
    } else {
      stop('平台已确认本门课程完成；联播关闭，停留当前课程');
    }
  }
  function start() {
    if (!state.queue.length) return status('请先扫描课程列表或加入当前课程');
    const current = route();
    const found = current ? state.queue.findIndex(x => route(x)?.id === current.id) : -1;
    if (found >= 0) state.index = found;
    if (state.index >= state.queue.length) state.index = 0;
    state.running = true;
    save();
    const target = route(state.queue[state.index]);
    if (!target) return stop('课程链接无效');
    if (!current || current.id !== target.id || current.type === 'special') {
      status('正在打开当前队列课程页面');
      location.assign(detailUrl(target.id));
    } else {
      status('任务已开始；等待平台显示课程完成状态');
    }
  }
  function manualNext() {
    if (!state.queue.length) return status('队列为空');
    if (!confirm('切换到队列下一门？此操作只切换页面，不代表当前课程已完成。')) return;
    state.running = true;
    nextCourse();
  }
  function makeButton(label, fn) {
    const b = document.createElement('button');
    b.textContent = label; b.addEventListener('click', fn);
    Object.assign(b.style, { padding: '7px 4px', border: '1px solid #ddd',
      background: '#fff', color: '#222', borderRadius: '5px', cursor: 'pointer' });
    return b;
  }
  function createPanel() {
    if (!document.body || document.getElementById('zgy-course-manager-panel')) return;
    panel = document.createElement('section');
    panel.id = 'zgy-course-manager-panel';
    Object.assign(panel.style, { position: 'fixed', top: '76px', left: '12px',
      zIndex: '2147483647', width: '232px', padding: '12px', background: '#fff',
      color: '#222', borderRadius: '8px', boxShadow: '0 2px 14px #0005',
      font: '13px/1.5 Arial,sans-serif' });

    const heading = document.createElement('strong');
    heading.textContent = '资管云课程队列管理助手';
    queueInfo = document.createElement('div');
    statusInfo = document.createElement('div');
    modeInfo = document.createElement('div');
    statusInfo.style.marginTop = '8px';
    modeInfo.style.cssText = 'margin-top:6px;color:#666;font-size:12px;';

    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: '1fr 1fr',
      gap: '6px', marginTop: '9px' });
    startBtn = makeButton('▶ 开始任务', () => state.running ? stop() : start());
    grid.append(
      makeButton('扫描本页课程', scanPage),
      makeButton('加入当前课程', () => addCourses([location.href])),
      startBtn,
      makeButton('切换下一门', manualNext),
      makeButton('重置当前位置', () => {
        const r = route();
        const i = r ? state.queue.findIndex(x => route(x)?.id === r.id) : -1;
        if (i >= 0) state.index = i;
        save(); status('已按当前课程重置队列位置');
      }),
      makeButton('清空队列', () => {
        if (!confirm('确定清空课程队列吗？')) return;
        state.running = false; state.queue = []; state.index = 0;
        save(); status('队列已清空');
      })
    );
    autoBtn = makeButton('', toggleAuto);
    autoBtn.style.cssText += ';width:100%;margin-top:9px;font-weight:bold;';
    const note = document.createElement('div');
    note.textContent = '仅管理队列和页面导航，不控制视频进度或代替学习。';
    note.style.cssText = 'margin-top:8px;color:#777;font-size:11px;';
    panel.append(heading, queueInfo, grid, autoBtn, modeInfo, statusInfo, note);
    document.body.appendChild(panel);
    render();
  }

  function tick() {
    if (!state.running) return;
    const current = route(), target = route(state.queue[state.index]);
    if (!current || !target || current.id !== target.id) return;
    if (platformCompleted()) onCompleted();
  }
  function init() {
    if (!document.body) return setTimeout(init, 100);
    createPanel();
    setInterval(tick, 1000);
  }
  init();
})();
