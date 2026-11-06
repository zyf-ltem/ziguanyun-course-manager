// ==UserScript==
// @name         资管云课程队列助手 V5.2
// @namespace    https://ziguanyun.com/
// @version      5.2.1
// @description  自动跳转视频、识别课程完成弹窗、跨课程联播开关
// @match        https://ziguanyun.com/*
// @match        https://www.ziguanyun.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  if (window.__ZGY_QUEUE_V52__) return;
  window.__ZGY_QUEUE_V52__ = true;

  // 保留旧版本的课程队列和联播设置
  const KEY = 'zgy-course-queue-v2';
  const AUTONEXT_KEY = 'zgy-cross-course-autoplay-v51';

  const PATH = /^\/course\/(special|detail)\/(\d+)\/?$/;
  const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
  const CHAPTER = /^第[一二三四五六七八九十百\d]+章/;

  const trim = s =>
    String(s || '').replace(/\s+/g, ' ').trim();

  const txt = el =>
    trim(el?.innerText || el?.textContent);

  const visible = el =>
    !!el?.getClientRects().length &&
    getComputedStyle(el).visibility !== 'hidden';

  function route(raw = location.href) {
    try {
      const u = new URL(raw, location.href);

      if (![
        'ziguanyun.com',
        'www.ziguanyun.com'
      ].includes(u.hostname)) {
        return null;
      }

      const m = u.pathname.match(PATH);

      return m ? {
        type: m[1],
        id: m[2]
      } : null;

    } catch {
      return null;
    }
  }

  function detailUrl(id) {
    return `${location.origin}/course/detail/${id}`;
  }

  function storeUrl(raw) {
    const r = route(raw);
    return r
      ? `${location.origin}/course/${r.type}/${r.id}`
      : null;
  }

  // 读取旧队列
  function load() {
    try {
      const old = JSON.parse(
        localStorage.getItem(KEY)
      );

      if (old && Array.isArray(old.queue)) {
        const seen = new Set();

        const queue = old.queue
          .map(storeUrl)
          .filter(u => {
            if (!u) return false;

            const id = route(u).id;
            if (seen.has(id)) return false;

            seen.add(id);
            return true;
          });

        const oldCurrent =
          old.queue[Number(old.index) || 0];

        const currentId =
          route(oldCurrent)?.id;

        const existingIndex = queue.findIndex(
          u => route(u).id === currentId
        );

        return {
          queue,
          index: existingIndex >= 0
            ? existingIndex : 0,
          running: !!old.running
        };
      }
    } catch (e) {
      console.warn(
        '[资管云V5.2] 读取队列失败',
        e
      );
    }

    return {
      queue: [],
      index: 0,
      running: false
    };
  }

  const data = load();

  let autoNext =
    localStorage.getItem(AUTONEXT_KEY) === 'true';

  let panel;
  let statusEl;
  let queueEl;
  let startButton;
  let autoNextButton;
  let modeEl;

  let lastMessage = '';
  let initialLocated = false;
  let catalogClicked = false;
  let courseToken = '';
  let videoState = null;

  let lastCatalogScan = 0;
  let lastChapterClick = 0;
  let chapterTries = new Map();

  function msg(s) {
    if (s === lastMessage) return;

    lastMessage = s;

    if (statusEl) {
      statusEl.textContent = s;
    }

    console.log('[资管云V5.2]', s);
  }

  function save() {
    localStorage.setItem(
      KEY,
      JSON.stringify(data)
    );
    render();
  }

  function render() {
    if (!panel) return;

    queueEl.textContent =
      `队列 ${data.queue.length} 门 · 当前 ` +
      `${data.queue.length ? data.index + 1 : 0}` +
      `/${data.queue.length}`;

    startButton.textContent = data.running
      ? '■ 停止任务'
      : '▶ 开始任务';

    autoNextButton.textContent = autoNext
      ? '跨课程联播：开'
      : '跨课程联播：关';

    autoNextButton.style.background = autoNext
      ? '#e8f6ed'
      : '#f5f5f5';

    autoNextButton.style.borderColor = autoNext
      ? '#59b778'
      : '#ddd';

    modeEl.textContent = autoNext
      ? '联播开启：本门完成后自动进入下一门'
      : '联播关闭：本门照常播放，完成后停留';
  }

  // 独立控制跨课程联播
  function toggleAutoNext() {
    autoNext = !autoNext;

    localStorage.setItem(
      AUTONEXT_KEY,
      String(autoNext)
    );

    render();

    msg(autoNext
      ? '联播已开启：本门完成后继续下一门'
      : '联播已关闭：本门继续学习，完成后不跳下一门'
    );
  }

  function resetCourse() {
    initialLocated = false;
    catalogClicked = false;
    videoState = null;
    chapterTries.clear();

    lastCatalogScan = 0;
    lastChapterClick = 0;
  }

  // ===== V5.2 新增：识别课程完成弹窗 =====
  function completion() {
    const page = (
      document.body?.innerText || ''
    ).replace(/\s+/g, '');

    // 情况1：课程结束时出现完成弹窗
    const completedPopup =
      page.includes('课程已学完') &&
      (
        page.includes('请为本课程推荐打分') ||
        page.includes('又完成了一门课程学习') ||
        page.includes('继续加油')
      );

    if (completedPopup) {
      return {
        known: true,
        done: 1,
        total: 1,
        complete: true
      };
    }

    // 情况2：课程学习节数已达到总节数
    const m = page.match(
      /本课程已学习(\d+)节[\/／]?共(\d+)节/
    );

    if (m) {
      const done = Number(m[1]);
      const total = Number(m[2]);

      return {
        known: total > 0,
        done,
        total,
        complete: total > 0 && done >= total
      };
    }

    // 情况3：课程介绍页显示100%
    if (/本课程已学100(?:\.0+)?%/.test(page)) {
      return {
        known: true,
        done: 100,
        total: 100,
        complete: true
      };
    }

    return {
      known: false,
      complete: false
    };
  }

  // 添加课程
  function add(urls) {
    let n = 0;

    for (const raw of urls) {
      const url = storeUrl(raw);
      const id = route(url)?.id;

      if (
        id &&
        !data.queue.some(
          u => route(u)?.id === id
        )
      ) {
        data.queue.push(url);
        n++;
      }
    }

    save();

    msg(
      `新增 ${n} 门，队列共 ${data.queue.length} 门`
    );
  }

  // 扫描课程列表
  function scan() {
    const urls = [
      ...document.querySelectorAll(
        'a[href], [data-href], [data-url]'
      )
    ].map(el =>
      el.getAttribute('href') ||
      el.getAttribute('data-href') ||
      el.getAttribute('data-url')
    );

    add(urls);
  }

  // 跳转下一门课程
  function advance() {
    if (!data.running) return;

    data.index++;
    resetCourse();

    if (data.index >= data.queue.length) {
      data.running = false;
      save();

      msg('队列中的课程均已处理完毕');
      return;
    }

    save();

    const targetId =
      route(data.queue[data.index])?.id;

    msg(
      `正在进入第 ${data.index + 1} 门课程的视频页`
    );

    if (targetId) {
      location.assign(
        detailUrl(targetId)
      );
    }
  }

  // 当前课程完成，根据联播设置决定是否继续
  function finishCurrentCourse() {
    if (!data.running) return;

    if (autoNext) {
      msg('已识别课程完成，联播开启：进入下一门');
      advance();

    } else {
      data.running = false;
      save();

      msg(
        '本门课程已完成；联播关闭，停留当前课程'
      );
    }
  }

  // 开始任务
  function start() {
    if (!data.queue.length) {
      return msg(
        '请先扫描课程或加入当前课程'
      );
    }

    const hereId = route()?.id;

    const found = data.queue.findIndex(
      u => route(u)?.id === hereId
    );

    if (found >= 0) {
      data.index = found;
    }

    if (data.index >= data.queue.length) {
      data.index = 0;
    }

    data.running = true;
    resetCourse();
    save();

    // 如果已经学完，遵守联播设置
    if (
      found >= 0 &&
      completion().complete
    ) {
      finishCurrentCourse();
      return;
    }

    const id =
      route(data.queue[data.index])?.id;

    if (!id) {
      return msg('课程链接无效');
    }

    // 直接打开视频播放页
    if (
      location.pathname !==
      `/course/detail/${id}`
    ) {
      msg('直接进入视频播放页');
      location.assign(detailUrl(id));

    } else {
      msg(
        '已进入视频页，正在寻找第一节未完成视频'
      );
    }
  }

  // 停止整个任务
  function stop() {
    data.running = false;
    save();

    videoState = null;
    msg('任务已停止');
  }

  // 获取课程目录文字
  function texts(re) {
    const result = [];

    if (!document.body) return result;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );

    let n;
    let counter = 0;

    while (
      (n = walker.nextNode()) &&
      counter++ < 25000
    ) {
      const s = trim(n.nodeValue);
      const el = n.parentElement;

      if (
        !s ||
        !re.test(s) ||
        !el ||
        !visible(el) ||
        el.closest('#zgy-v52-panel')
      ) continue;

      if (
        el.getBoundingClientRect().left <
        innerWidth * 0.50
      ) continue;

      result.push({ el, s });
    }

    return result;
  }

  // 找到章节行或视频行
  function rowFrom(el, isChapter) {
    for (
      let p = el, d = 0;
      p && d < 9;
      p = p.parentElement, d++
    ) {
      const s = txt(p);
      const r = p.getBoundingClientRect();

      if (
        r.width < 90 ||
        r.width > 760 ||
        r.height < 20 ||
        r.height > 115 ||
        s.length > 220
      ) continue;

      if (isChapter) {
        if (
          CHAPTER.test(s) &&
          /\d+\s*节/.test(s)
        ) return p;

      } else if (
        TIME.test(s) &&
        s.length > 4 &&
        !/\d+\s*节\s*\d{1,2}:\d{2}/.test(s)
      ) {
        const title = s
          .replace(TIME, '')
          .replace(
            /已学(?:完|\s*\d+%)/g,
            ''
          ).trim();

        if (title.length >= 2) {
          return p;
        }
      }
    }

    return null;
  }

  function isBefore(a, b) {
    return !!(
      a.compareDocumentPosition(b) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function click(el) {
    if (!el) return;

    el.scrollIntoView({
      block: 'nearest',
      behavior: 'instant'
    });

    el.click();
  }

  // 定位第一节未完成的小节
  function locateFirstUnfinished() {
    if (
      Date.now() - lastCatalogScan < 700
    ) return;

    lastCatalogScan = Date.now();

    const tab =
      texts(/^课程目录$/)[0]?.el;

    if (!tab) {
      return msg('等待课程目录加载');
    }

    const headings = [
      ...new Set(
        texts(CHAPTER)
          .map(x => rowFrom(x.el, true))
          .filter(Boolean)
      )
    ];

    const lessonRows = [
      ...new Set(
        texts(
          /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*已学(?:完|\d+%))?$/
        )
          .map(x => rowFrom(x.el, false))
          .filter(Boolean)
      )
    ];

    const lessons = lessonRows.map(el => {
      const s = txt(el);

      return {
        el,
        label: s,
        done: /已学完|已学\s*100%/.test(s)
      };
    });

    // 课程目录未展开
    if (
      !headings.length &&
      !lessons.length
    ) {
      if (!catalogClicked) {
        catalogClicked = true;
        click(tab);

        msg('正在打开课程目录');

      } else {
        msg('等待章节加载，请确认课程目录已展开');
      }

      return;
    }

    function choose(lesson) {
      initialLocated = true;
      videoState = null;

      click(lesson.el);

      msg(
        '已选择未完成小节：' +
        lesson.label.slice(0, 30)
      );
    }

    // 第一章之前可能有概览视频
    const prefix = lessons.filter(
      x =>
        !headings.length ||
        isBefore(x.el, headings[0])
    );

    const pendingPrefix =
      prefix.find(x => !x.done);

    if (pendingPrefix) {
      return choose(pendingPrefix);
    }

    // 按顺序检查章节
    for (
      let i = 0;
      i < headings.length;
      i++
    ) {
      const section = lessons.filter(
        x =>
          isBefore(headings[i], x.el) &&
          (
            !headings[i + 1] ||
            isBefore(x.el, headings[i + 1])
          )
      );

      const pending =
        section.find(x => !x.done);

      if (pending) {
        return choose(pending);
      }

      // 折叠章节先展开
      if (!section.length) {
        const name = txt(headings[i]);

        const times =
          chapterTries.get(name) || 0;

        if (times >= 3) {
          stop();

          return msg(
            '章节无法展开，请手动检查：' +
            name.slice(0, 24)
          );
        }

        if (
          Date.now() - lastChapterClick > 900
        ) {
          chapterTries.set(
            name,
            times + 1
          );

          lastChapterClick = Date.now();

          click(headings[i]);

          msg(
            '正在展开章节：' +
            name.slice(0, 24)
          );
        }

        return;
      }
    }

    msg(
      '目录未发现未完成小节，等待课程进度更新'
    );
  }

  // 取得正在播放的视频
  function activeVideo() {
    return [
      ...document.querySelectorAll('video')
    ]
      .filter(
        v =>
          visible(v) &&
          Number.isFinite(v.duration) &&
          v.duration > 1
      )
      .sort((a, b) => {
        const x = a.getBoundingClientRect();
        const y = b.getBoundingClientRect();

        return (
          y.width * y.height -
          x.width * x.height
        );
      })[0] || null;
  }

  // 视频直接跳到最后1秒
  function seekNow(v) {
    try {
      v.currentTime = Math.max(
        0,
        v.duration - 1
      );

      const promise = v.play();

      if (promise?.catch) {
        promise.catch(() =>
          msg(
            '自动播放被阻止，请手动播放一次'
          )
        );
      }

      msg(
        '已跳到最后1秒，等待网站自动续播'
      );

      return true;

    } catch (e) {
      msg(
        '视频跳转失败：' +
        e.message
      );

      return false;
    }
  }

  // 检测视频变化，不主动点击下一节
  function watchVideo() {
    const v = activeVideo();

    if (!v) {
      return msg('等待视频加载');
    }

    const now = Date.now();
    const src = v.currentSrc;

    const changed =
      !videoState ||
      videoState.el !== v ||
      videoState.src !== src ||
      Math.abs(
        videoState.duration - v.duration
      ) > 0.5 ||
      (
        videoState.nearEnd &&
        !v.seeking &&
        v.currentTime <
          Math.min(3, v.duration / 2) &&
        now - videoState.lastSeek > 600
      );

    // 新视频加载后立即跳转
    if (changed) {
      videoState = {
        el: v,
        src,
        duration: v.duration,
        nearEnd: false,
        lastSeek: 0
      };

      if (seekNow(v)) {
        videoState.nearEnd = true;
        videoState.lastSeek = now;
      }

      return;
    }

    // 网站自动续播
    if (v.ended) {
      return msg(
        '本节结束，等待网站自动进入下一节'
      );
    }

    // 视频暂停时尝试恢复
    if (v.paused) {
      const promise = v.play();

      if (promise?.catch) {
        promise.catch(() =>
          msg('请手动点击视频播放')
        );
      }
    }
  }

  // 主控制逻辑
  function tick() {
    if (
      !data.running ||
      !data.queue.length ||
      data.index >= data.queue.length
    ) return;

    const here = route();

    const target =
      route(data.queue[data.index]);

    if (
      !here ||
      !target ||
      here.id !== target.id
    ) return;

    if (courseToken !== here.id) {
      courseToken = here.id;
      resetCourse();
    }

    // 优先识别课程是否完成
    // 包括 V5.2 新增的完成弹窗
    if (completion().complete) {
      finishCurrentCourse();
      return;
    }

    // 跳过介绍页，直接到视频页
    if (here.type === 'special') {
      msg(
        '跳过介绍页，直接进入视频播放页'
      );

      location.replace(
        detailUrl(here.id)
      );

      return;
    }

    if (!initialLocated) {
      locateFirstUnfinished();
    } else {
      watchVideo();
    }
  }

  // 创建按钮
  function button(name, onclick) {
    const el =
      document.createElement('button');

    el.textContent = name;
    el.onclick = onclick;

    Object.assign(el.style, {
      padding: '7px 4px',
      border: '1px solid #ddd',
      background: '#fff',
      color: '#222',
      borderRadius: '5px',
      cursor: 'pointer'
    });

    return el;
  }

  // 创建悬浮面板
  function renderPanel() {
    if (
      !document.body ||
      document.getElementById(
        'zgy-v52-panel'
      )
    ) return;

    panel = document.createElement('div');
    panel.id = 'zgy-v52-panel';

    Object.assign(panel.style, {
      position: 'fixed',
      top: '76px',
      left: '12px',
      zIndex: '2147483647',
      background: '#fff',
      color: '#222',
      padding: '12px',
      width: '232px',
      borderRadius: '8px',
      boxShadow: '0 2px 14px #0005',
      font: '13px/1.5 Arial,sans-serif'
    });

    const head =
      document.createElement('b');

    head.textContent =
      '资管云课程队列 V5.2';

    queueEl =
      document.createElement('div');

    statusEl =
      document.createElement('div');

    statusEl.style.marginTop = '8px';
    statusEl.textContent = '就绪';

    modeEl =
      document.createElement('div');

    modeEl.style.cssText =
      'margin-top:6px;color:#666;font-size:12px;';

    const grid =
      document.createElement('div');

    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '6px',
      marginTop: '9px'
    });

    startButton = button(
      '▶ 开始任务',
      () => data.running ? stop() : start()
    );

    grid.append(
      button('扫描本页课程', scan),

      button(
        '加入当前课',
        () => add([location.href])
      ),

      startButton,

      button('跳到下一门', () => {
        if (
          data.running &&
          confirm(
            '确定手动跳过当前整门课程？'
          )
        ) {
          advance();
        }
      }),

      button('重新定位首节', () => {
        resetCourse();
        msg(
          '重新寻找第一节未完成小节'
        );
      }),

      button('清空队列', () => {
        if (
          !confirm(
            '确定清空课程队列吗？'
          )
        ) return;

        stop();

        data.queue = [];
        data.index = 0;

        save();
      })
    );

    // 跨课程联播独立开关
    autoNextButton = button(
      '',
      toggleAutoNext
    );

    autoNextButton.style.cssText +=
      ';width:100%;margin-top:9px;font-weight:bold;';

    panel.append(
      head,
      queueEl,
      grid,
      autoNextButton,
      modeEl,
      statusEl
    );

    document.body.appendChild(panel);

    render();
  }

  function init() {
    if (!document.body) {
      return setTimeout(init, 100);
    }

    renderPanel();

    // 每350毫秒检测一次状态
    setInterval(tick, 350);
  }

  init();
})();
