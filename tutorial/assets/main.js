/* ============================================================
   pi-feishu 源码教程 · 共享脚本
   功能：侧边栏导航 / 面包屑 / 上一章下一章 / 代码高亮与复制 /
         阅读进度条 / 回到顶部 / 移动端菜单
   纯原生 JS，无任何外部依赖
   ============================================================ */

(function () {
  "use strict";

  var TUTORIAL = window.TUTORIAL;
  if (!TUTORIAL) return;

  var pathParts = location.pathname.split("/").filter(Boolean);
  var current = pathParts[pathParts.length - 1] || "index.html";
  var isIndex = current === "index.html";
  var bodyPart = document.body.getAttribute("data-part");
  var prefix = isIndex ? "" : "../";

  // ---------- 定位当前章节 ----------
  var flat = [];
  TUTORIAL.parts.forEach(function (part) {
    part.chapters.forEach(function (ch) {
      flat.push({ part: part, chapter: ch });
    });
  });

  var currentChapter = null;
  var currentPart = null;
  flat.forEach(function (item) {
    if (item.part.id === bodyPart && item.chapter.file === current) {
      currentChapter = item.chapter;
      currentPart = item.part;
    }
  });
  if (isIndex) currentPart = TUTORIAL.parts[0];

  function href(part, file) {
    return prefix + part.id + "/" + file;
  }

  // ---------- 侧边栏 ----------
  function renderSidebar() {
    var sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    var html = '<a class="side-brand" href="' + prefix + 'index.html">' + TUTORIAL.title +
      "<small>" + TUTORIAL.subtitle + "</small></a>";
    TUTORIAL.parts.forEach(function (part) {
      html += '<div class="part-title">' + part.label + " · " + part.title + "</div>";
      part.chapters.forEach(function (ch, i) {
        var active = currentChapter && part.id === currentPart.id && ch.file === currentChapter.file;
        var num = String(i + 1).padStart(2, "0");
        html += '<a class="side-link' + (active ? " active" : "") + '" href="' + href(part, ch.file) + '">' +
          '<span class="num">' + num + "</span>" + ch.title + "</a>";
      });
    });
    sidebar.innerHTML = html;
  }

  // ---------- 面包屑 ----------
  function renderBreadcrumb() {
    var el = document.getElementById("breadcrumb");
    if (!el) return;
    if (isIndex) { el.innerHTML = "首页"; return; }
    var html = '<a href="' + prefix + 'index.html">首页</a>';
    if (currentPart) {
      html += " / <a href=\"" + href(currentPart, currentPart.chapters[0].file) + '">' + currentPart.title + "</a>";
    }
    if (currentChapter) html += " / <span>" + currentChapter.title + "</span>";
    el.innerHTML = html;
  }

  // ---------- 上一章 / 下一章 ----------
  function renderPageNav() {
    var el = document.getElementById("page-nav");
    if (!el) return;
    var idx = -1;
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].chapter.file === currentChapter.file && flat[i].part.id === bodyPart) { idx = i; break; }
    }
    var prev = isIndex ? null : (idx > 0 ? flat[idx - 1] : null);
    var next = isIndex ? flat[0] : (idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null);

    var html = "";
    if (prev) {
      html += '<a class="prev" href="' + href(prev.part, prev.chapter.file) + '">' +
        '<span class="dir">← 上一章</span><span class="ttl">' + prev.chapter.title + "</span></a>";
    } else {
      html += "<span></span>";
    }
    if (next) {
      html += '<a class="next" href="' + href(next.part, next.chapter.file) + '">' +
        '<span class="dir">下一章 →</span><span class="ttl">' + next.chapter.title + "</span></a>";
    }
    el.innerHTML = html;
  }

  // ---------- 移动端菜单 ----------
  function initMenu() {
    var btn = document.getElementById("menu-btn");
    var overlay = document.getElementById("overlay");
    var sidebar = document.getElementById("sidebar");
    if (!btn || !overlay || !sidebar) return;
    function close() {
      sidebar.classList.remove("open");
      overlay.classList.remove("show");
    }
    btn.addEventListener("click", function () {
      sidebar.classList.toggle("open");
      overlay.classList.toggle("show");
    });
    overlay.addEventListener("click", close);
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest("a")) close();
    });
  }

  // ---------- 代码高亮 ----------
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var KEYWORDS = "const|let|var|function|return|if|else|for|while|async|await|class|new|" +
    "import|export|from|interface|type|extends|implements|public|private|readonly|enum|" +
    "try|catch|finally|throw|of|in|null|undefined|true|false|this|static|get|set|" +
    "default|switch|case|break|continue|typeof|void|yield|super|delete";

  var tokenRe = new RegExp(
    "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)" +
    "|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)" +
    "|\\b(" + KEYWORDS + ")\\b" +
    "|(\\b\\d+(?:\\.\\d+)?\\b)",
    "g"
  );

  function highlightCode(code) {
    var html = "";
    var last = 0;
    var m;
    var cls = ["tok-c", "tok-s", "tok-k", "tok-n"];
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(code))) {
      html += escapeHtml(code.slice(last, m.index));
      var group = -1;
      for (var i = 1; i <= 4; i++) {
        if (m[i] !== undefined) { group = i - 1; break; }
      }
      html += '<span class="' + cls[group] + '">' + escapeHtml(m[0]) + "</span>";
      last = m.index + m[0].length;
    }
    html += escapeHtml(code.slice(last));
    return html;
  }

  function initCode() {
    document.querySelectorAll("pre code").forEach(function (codeEl) {
      var raw = codeEl.textContent || "";
      codeEl.innerHTML = highlightCode(raw);
      var pre = codeEl.parentElement;
      if (!pre) return;
      pre.classList.add("has-copy");
      var btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "复制";
      btn.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(raw).then(function () {
            btn.textContent = "已复制";
            setTimeout(function () { btn.textContent = "复制"; }, 1500);
          }).catch(function () {});
        }
      });
      pre.appendChild(btn);
    });
  }

  // ---------- 阅读进度条 ----------
  function initProgress() {
    var bar = document.getElementById("progress-bar");
    if (!bar) return;
    function update() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var p = max > 0 ? (doc.scrollTop / max) * 100 : 0;
      bar.style.width = p + "%";
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  // ---------- 回到顶部 ----------
  function initBackTop() {
    var btn = document.getElementById("back-top");
    if (!btn) return;
    window.addEventListener("scroll", function () {
      btn.classList.toggle("show", document.documentElement.scrollTop > 400);
    }, { passive: true });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  renderSidebar();
  renderBreadcrumb();
  renderPageNav();
  initMenu();
  initCode();
  initProgress();
  initBackTop();
})();
