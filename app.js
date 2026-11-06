/* 小芽拼读 · 拼音与英语启蒙 —— 前端逻辑（无构建，直接运行） */
(function () {
  "use strict";

  var DATA = window.APP_DATA;
  var header = document.getElementById("header");
  var view = document.getElementById("view");
  var dock = document.getElementById("dock");
  var toast = document.getElementById("toast");

  var itemMap = {
    pinyin: Object.fromEntries(DATA.pinyin.items.map(function (i) { return [i.id, i]; })),
    english: Object.fromEntries(DATA.english.items.map(function (i) { return [i.id, i]; }))
  };

  var state = {
    mode: "pinyin",
    page: "landing",
    id: null,
    index: 0,
    audioState: "idle",
    toastTimer: null
  };

  var audioEl = new Audio();
  audioEl.preload = "auto";
  audioEl.setAttribute("playsinline", "");
  audioEl.setAttribute("webkit-playsinline", "");

  audioEl.addEventListener("ended", function () {
    setAudioState("idle");
  });
  audioEl.addEventListener("playing", function () {
    setAudioState("playing");
  });
  audioEl.addEventListener("pause", function () {
    if (state.audioState === "playing" || state.audioState === "loading") {
      setAudioState("idle");
    }
  });
  audioEl.addEventListener("error", function () {
    setAudioState("error");
    showToast("音频加载失败，请检查网络后重试");
  });

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getItem(mode, id) {
    return itemMap[mode][id];
  }

  /* ---------- 图标 ---------- */
  function sproutSVG() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 21v-8"/>' +
      '<path d="M12 13c0-3.2 2-5.4 5.4-5.4 0 3.4-2.2 5.4-5.4 5.4z" fill="currentColor" stroke="none"/>' +
      '<path d="M12 13c0-3.2-2-5.4-5.4-5.4 0 3.4 2.2 5.4 5.4 5.4z" fill="currentColor" stroke="none" opacity="0.72"/>' +
      '<path d="M6 21h12"/>' +
      "</svg>"
    );
  }

  function backSVG() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M15 5l-7 7 7 7"/>' +
      "</svg>"
    );
  }

  function prevSVG() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M15 5l-7 7 7 7"/>' +
      "</svg>"
    );
  }

  function nextSVG() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 5l7 7-7 7"/>' +
      "</svg>"
    );
  }

  function playTriSVG() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l13 7-13 7z"/></svg>';
  }

  function speakerSVG() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>' +
      '<path class="speaker-wave w1" d="M15.5 8.6a5 5 0 010 6.8"/>' +
      '<path class="speaker-wave w2" d="M18.3 5.8a9 9 0 010 12.4"/>' +
      "</svg>"
    );
  }

  function mascotSVG() {
    return (
      '<svg viewBox="0 0 140 140" aria-hidden="true">' +
      '<circle cx="70" cy="70" r="64" fill="#F7D36E"/>' +
      '<circle cx="119" cy="36" r="5" fill="#FFF6D8"/>' +
      '<path d="M118 31v10M113 36h10" stroke="#E7B94E" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M55 44l-6-15 14 9z" fill="#5C9B64" stroke-linejoin="round"/>' +
      '<path d="M70 40l-2-17 12 13z" fill="#5C9B64" stroke-linejoin="round"/>' +
      '<path d="M85 44l6-15-14 9z" fill="#5C9B64" stroke-linejoin="round"/>' +
      '<path d="M41 72c0-19 14-33 33-33h7c15 0 26 12 26 27v12c0 15-12 27-27 27H67c-14 0-26-11-26-26z" fill="#7BB77F"/>' +
      '<ellipse cx="70" cy="88" rx="24" ry="17" fill="#B7D9AE"/>' +
      '<circle cx="57" cy="66" r="8" fill="#FFFFFF"/>' +
      '<circle cx="59" cy="67" r="4" fill="#2C3A31"/>' +
      '<circle cx="89" cy="65" r="7" fill="#FFFFFF"/>' +
      '<circle cx="91" cy="66" r="3.5" fill="#2C3A31"/>' +
      '<path d="M64 84c5 4 12 4 17 0" stroke="#2C3A31" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
      '<circle cx="46" cy="78" r="4" fill="#F3A78A" opacity="0.72"/>' +
      '<circle cx="101" cy="77" r="3.5" fill="#F3A78A" opacity="0.72"/>' +
      "</svg>"
    );
  }

  /* ---------- 头部 ---------- */
  function modeSwitchHTML(mode) {
    return (
      '<div class="mode-switch" role="group" aria-label="切换学习模式">' +
      '<button class="mode-btn' + (mode === "pinyin" ? " active" : "") + '" data-mode="pinyin">拼音</button>' +
      '<button class="mode-btn' + (mode === "english" ? " active" : "") + '" data-mode="english">英语</button>' +
      "</div>"
    );
  }

  function renderHeader() {
    var isDetail = state.page === "detail";
    if (!isDetail) {
      header.innerHTML =
        '<div class="topbar-inner">' +
        '<button class="brand" data-action="home" aria-label="回到首页">' +
        '<span class="brand-mark">' + sproutSVG() + "</span>" +
        '<span class="brand-text"><strong>小芽拼读</strong><small>拼音 · 英语启蒙</small></span>' +
        "</button>" +
        modeSwitchHTML(state.mode) +
        "</div>";
    } else {
      var item = getItem(state.mode, state.id);
      var sub = item
        ? state.mode === "english"
          ? "English · " + item.group
          : "拼音 · " + item.group
        : "";
      header.innerHTML =
        '<div class="topbar-inner">' +
        '<button class="back-btn" data-action="back" aria-label="返回">' + backSVG() + "</button>" +
        '<div class="detail-title"><strong>跟我读</strong><small>' + escapeHTML(sub) + "</small></div>" +
        modeSwitchHTML(state.mode) +
        "</div>";
    }
    header.classList.toggle("detail-topbar", isDetail);
  }

  /* ---------- 首页 ---------- */
  function heroHTML(isEnglish) {
    return (
      '<section class="hero hero-' + (isEnglish ? "english" : "pinyin") + '">' +
      '<div class="hero-copy">' +
      '<p class="eyebrow">4–5 岁 · 每天 5 分钟</p>' +
      '<h1>' + (isEnglish ? "今天想读<br><em>哪个字母？</em>" : "今天想读<br><em>哪一个？</em>") + "</h1>" +
      '<p class="hero-sub">' +
      (isEnglish ? "先认大写，再认小写，听一听例词。" : "声母、韵母、复韵母，点一点，跟着读。") +
      "</p>" +
      "</div>" +
      '<div class="mascot-wrap" aria-hidden="true">' +
      mascotSVG() +
      '<span class="mascot-badge">' + (isEnglish ? "ABC" : "bō") + "</span>" +
      "</div>" +
      "</section>"
    );
  }

  function quickNavHTML(categories) {
    return (
      '<nav class="quick-nav" aria-label="分类导航">' +
      categories
        .map(function (c) {
          return '<button class="chip" data-scroll="' + c.id + '">' + escapeHTML(c.title) + "</button>";
        })
        .join("") +
      "</nav>"
    );
  }

  function categoryHTML(mode, category) {
    var data = DATA[mode];
    var cards = category.items
      .map(function (id) {
        var item = getItem(mode, id);
        var isEnglish = mode === "english";
        var isLong = mode === "pinyin" && item.display.length > 1;
        var label = isEnglish ? "学习字母 " + item.display : "学习拼音 " + item.display;
        return (
          '<button class="sound-card' + (isEnglish ? " is-english" : "") + '" data-id="' + item.id + '" aria-label="' + escapeHTML(label) + '">' +
          '<span class="card-glyph' + (isLong ? " is-long" : "") + '">' + escapeHTML(item.display) + "</span>" +
          "</button>"
        );
      })
      .join("");

    var note = category.note ? '<p class="section-note">' + escapeHTML(category.note) + "</p>" : "";
    var legend =
      category.id === "special"
        ? '<div class="group-legend"><span>平舌音 · z c s</span><span>翘舌音 · zh ch sh r</span></div>'
        : "";

    return (
      '<section class="category" id="section-' + category.id + '">' +
      '<div class="section-head">' +
      '<div class="section-title-row"><h2>' + escapeHTML(category.title) + '</h2><span class="count">' + category.items.length + "</span></div>" +
      '<p class="section-desc">' + escapeHTML(category.desc) + "</p>" +
      note +
      "</div>" +
      legend +
      '<div class="card-grid">' + cards + "</div>" +
      "</section>"
    );
  }

  function startDockHTML() {
    return (
      '<div class="dock-inner">' +
      '<button class="start-btn" data-action="start">' +
      '<span class="start-icon">' + playTriSVG() + "</span><span>开始学习</span>" +
      "</button>" +
      "</div>"
    );
  }

  function renderLanding() {
    var data = DATA[state.mode];
    var isEnglish = state.mode === "english";
    var categories = data.categories
      .map(function (c) {
        return categoryHTML(state.mode, c);
      })
      .join("");

    view.innerHTML =
      '<div class="landing">' +
      heroHTML(isEnglish) +
      quickNavHTML(data.categories) +
      categories +
      '<footer class="credits">' +
      "拼音音频：Chen Wang · <a href='https://github.com/hugolpz/audio-cmn' target='_blank' rel='noopener'>audio-cmn</a>（CC BY-SA）<br>" +
      "英文与例句发音：Edge TTS 生成（女声）" +
      "</footer>" +
      "</div>";

    dock.innerHTML = startDockHTML();
  }

  /* ---------- 详情页 ---------- */
  function detailCardHTML(mode, item, index, total) {
    var progress = (index + 1) + " / " + total;
    var top = '<div class="card-topline"><span class="pill">' + escapeHTML(item.group) + '</span><span class="progress">' + progress + "</span></div>";

    if (mode === "english") {
      var other = item.caseType === "upper" ? item.letter.toLowerCase() : item.letter;
      var meta =
        item.caseType === "upper"
          ? "大写 " + item.letter + " · 小写 " + other
          : "小写 " + item.display + " · 大写 " + item.letter;
      return (
        top +
        '<div class="glyph-wrap"><span class="glyph-halo"></span><span class="big-glyph is-english">' + escapeHTML(item.display) + "</span></div>" +
        '<p class="letter-meta">' + escapeHTML(meta) + "</p>" +
        '<div class="word-chip"><span class="word-emoji">' + escapeHTML(item.emoji) + "</span>" +
        '<span class="word">' + escapeHTML(item.word) + "</span>" +
        '<span class="word-zh">' + escapeHTML(item.zh) + "</span></div>" +
        '<div class="case-block">' +
        '<p class="case-label">例句</p>' +
        '<p class="case-sentence en" lang="en">' + escapeHTML(item.sentence) + "</p>" +
        '<p class="case-translation">' + escapeHTML(item.sentenceZh) + "</p>" +
        "</div>"
      );
    }

    var isLong = item.display.length > 1;
    return (
      top +
      '<div class="glyph-wrap"><span class="glyph-halo"></span><span class="big-glyph' + (isLong ? " is-long" : "") + '">' + escapeHTML(item.display) + "</span></div>" +
      '<span class="sound-pill">读作 ' + escapeHTML(item.sound) + "</span>" +
      '<div class="case-block">' +
      '<div class="case-emoji">' + escapeHTML(item.emoji) + "</div>" +
      '<p class="case-label">跟我读一读</p>' +
      '<p class="case-sentence">' + escapeHTML(item.sentence) + "</p>" +
      "</div>"
    );
  }

  function controlsHTML(isFirst) {
    return (
      '<div class="dock-inner">' +
      '<div class="controls">' +
      '<button class="nav-btn" data-action="prev" aria-label="上一个"' + (isFirst ? " disabled" : "") + ">" +
      prevSVG() + "<span>上一个</span></button>" +
      '<button class="play-btn" data-action="play" aria-label="播放">' +
      speakerSVG() + '<span class="play-label">播放</span></button>' +
      '<button class="nav-btn" data-action="next" aria-label="下一个">' +
      nextSVG() + "<span>下一个</span></button>" +
      "</div>" +
      "</div>"
    );
  }

  function renderDetail(direction) {
    var item = getItem(state.mode, state.id);
    if (!item) {
      openLanding(state.mode);
      return;
    }
    var order = DATA[state.mode].order;
    state.index = order.indexOf(item.id);
    var total = order.length;
    var isFirst = state.index === 0;

    view.innerHTML =
      '<section class="detail-view">' +
      '<article class="detail-card' + (state.mode === "english" ? " is-english" : "") + (direction ? " slide-from-" + direction : "") + '">' +
      detailCardHTML(state.mode, item, state.index, total) +
      "</article>" +
      '<p class="audio-note">' +
      (state.mode === "english" ? "先听 3 遍字母名，再听 2 遍例句和中文" : "先听 3 遍发音，再听 2 遍例句") +
      "</p>" +
      "</section>";

    dock.innerHTML = controlsHTML(isFirst);
    prepareAudio(item.audio);
    updatePlayButton();
  }

  /* ---------- 音频 ---------- */
  function setAudioState(next) {
    state.audioState = next;
    updatePlayButton();
  }

  function updatePlayButton() {
    var btn = dock.querySelector(".play-btn");
    if (!btn) {
      return;
    }
    var label = btn.querySelector(".play-label");
    btn.classList.remove("is-playing", "is-loading", "is-error");
    if (state.audioState === "playing") {
      btn.classList.add("is-playing");
      if (label) label.textContent = "播放中";
      btn.setAttribute("aria-label", "停止播放");
    } else if (state.audioState === "loading") {
      btn.classList.add("is-loading");
      if (label) label.textContent = "准备中";
      btn.setAttribute("aria-label", "准备中");
    } else if (state.audioState === "error") {
      btn.classList.add("is-error");
      if (label) label.textContent = "重试";
      btn.setAttribute("aria-label", "重试播放");
    } else {
      if (label) label.textContent = "播放";
      btn.setAttribute("aria-label", "播放");
    }
  }

  function stopAudio() {
    if (audioEl) {
      try {
        audioEl.pause();
      } catch (e) { /* noop */ }
      try {
        audioEl.currentTime = 0;
      } catch (e) { /* noop */ }
    }
    state.audioState = "idle";
    updatePlayButton();
  }

  function prepareAudio(url) {
    stopAudio();
    audioEl.src = url;
    audioEl.load();
  }

  function playAudio() {
    if (state.page !== "detail") {
      return;
    }
    if (state.audioState === "playing" || state.audioState === "loading") {
      stopAudio();
      return;
    }
    setAudioState("loading");
    audioEl.currentTime = 0;
    audioEl.play()
      .then(function () {
        setAudioState("playing");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          return;
        }
        setAudioState("error");
        showToast("音频加载失败，请检查网络后重试");
      });
  }

  /* ---------- 路由 ---------- */
  function parseRoute() {
    var raw = location.hash.replace(/^#\/?/, "");
    var parts = raw.split("/").filter(Boolean);
    if (parts.length === 0) {
      return { mode: "pinyin", page: "landing", id: null };
    }
    var mode = parts[0] === "english" ? "english" : "pinyin";
    if (parts.length === 1) {
      return { mode: mode, page: "landing", id: null };
    }
    return { mode: mode, page: "detail", id: decodeURIComponent(parts[1]) };
  }

  function applyRoute(route) {
    state.mode = route.mode;
    state.page = route.page;
    state.id = route.id;
    if (state.page === "detail") {
      var item = getItem(state.mode, state.id);
      if (!item) {
        state.page = "landing";
        state.id = null;
      } else {
        state.index = DATA[state.mode].order.indexOf(item.id);
      }
    }
  }

  function renderState(direction) {
    stopAudio();
    renderHeader();
    if (state.page === "landing") {
      renderLanding();
    } else {
      renderDetail(direction || null);
    }
    document.title = documentTitle();
  }

  function renderFromUrl() {
    try {
      applyRoute(parseRoute());
      renderState(null);
    } catch (err) {
      console.error(err);
      showToast("渲染出错：" + (err && err.message ? err.message : err));
    }
  }

  // 尽力同步地址栏，但不依赖它：地址更新失败时视图仍会照常切换。
  function pushHash(target) {
    try {
      history.pushState(null, "", target);
    } catch (err) {
      try {
        history.replaceState(null, "", target);
      } catch (err2) {
        /* 忽略：某些沙箱环境不允许修改地址 */
      }
    }
  }

  function openLanding(mode) {
    state.mode = mode;
    state.page = "landing";
    state.id = null;
    pushHash("#/" + mode);
    renderState(null);
  }

  function openDetail(mode, id) {
    var item = getItem(mode, id);
    if (!item) {
      openLanding(mode);
      return;
    }
    state.mode = mode;
    state.page = "detail";
    state.id = id;
    state.index = DATA[mode].order.indexOf(id);
    pushHash("#/" + mode + "/" + id);
    renderState(null);
  }

  function goTo(delta) {
    if (state.page !== "detail") {
      return;
    }
    var order = DATA[state.mode].order;
    var len = order.length;
    var newIndex = (state.index + delta + len) % len;
    state.id = order[newIndex];
    state.index = newIndex;
    pushHash("#/" + state.mode + "/" + state.id);
    renderState(delta < 0 ? "left" : "right");
    playAudio();
  }

  function documentTitle() {
    if (state.page === "landing") {
      return state.mode === "english" ? "小芽拼读 · 英语字母" : "小芽拼读 · 拼音启蒙";
    }
    var item = getItem(state.mode, state.id);
    return (item ? item.display + " · " : "") + (state.mode === "english" ? "英语" : "拼音") + " · 小芽拼读";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2600);
  }

  /* ---------- 事件 ---------- */
  function handleClick(e) {
    var modeBtn = e.target.closest(".mode-btn");
    if (modeBtn) {
      var nextMode = modeBtn.getAttribute("data-mode");
      if (nextMode !== state.mode) {
        openLanding(nextMode);
      }
      return;
    }

    var card = e.target.closest(".sound-card");
    if (card) {
      openDetail(state.mode, card.getAttribute("data-id"));
      return;
    }

    var chip = e.target.closest("[data-scroll]");
    if (chip) {
      var section = document.getElementById("section-" + chip.getAttribute("data-scroll"));
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    var actionEl = e.target.closest("[data-action]");
    if (!actionEl) {
      return;
    }
    var action = actionEl.getAttribute("data-action");
    if (action === "home" || action === "back") {
      openLanding(state.mode);
    } else if (action === "start") {
      openDetail(state.mode, DATA[state.mode].order[0]);
    } else if (action === "prev") {
      goTo(-1);
    } else if (action === "next") {
      goTo(1);
    } else if (action === "play") {
      playAudio();
    }
  }

  document.addEventListener("click", function (e) {
    try {
      handleClick(e);
    } catch (err) {
      console.error(err);
      showToast("点击出错：" + (err && err.message ? err.message : err));
    }
  });

  var touchStartX = 0;
  var touchStartY = 0;
  view.addEventListener(
    "touchstart",
    function (e) {
      if (state.page !== "detail") return;
      var t = e.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
    },
    { passive: true }
  );
  view.addEventListener(
    "touchend",
    function (e) {
      if (state.page !== "detail") return;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchStartX;
      var dy = t.clientY - touchStartY;
      if (Math.abs(dx) > 55 && Math.abs(dy) < 40) {
        if (dx < 0) {
          goTo(1);
        } else {
          goTo(-1);
        }
      }
    },
    { passive: true }
  );

  document.addEventListener("keydown", function (e) {
    if (state.page !== "detail") return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(1);
    } else if (e.key === " ") {
      e.preventDefault();
      playAudio();
    }
  });

  window.addEventListener("hashchange", renderFromUrl);

  window.addEventListener("error", function (e) {
    if (e && e.message) {
      console.error("page error:", e.message);
      showToast("页面出错：" + e.message);
    }
  });

  renderFromUrl();
})();
