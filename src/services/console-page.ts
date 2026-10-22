/**
 * 브라우저 콘솔 한 페이지. 로그인 없이 리뷰를 요청하므로 이 포트를 공개 인터넷에 열면 안 된다.
 * 최근 카드는 같은 Pull Request의 최신 작업만 보여주고, 지적 본문은 저장하지 않는다.
 */
export const CONSOLE_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 리뷰 봇</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI Variable", "Segoe UI", sans-serif;
      color: #f6f1ea;
      background:
        radial-gradient(900px 420px at 10% -10%, rgba(212, 165, 116, 0.18), transparent 60%),
        radial-gradient(700px 380px at 100% 0%, rgba(90, 122, 158, 0.16), transparent 55%),
        #0c0b0a;
    }
    main { max-width: 44rem; margin: 0 auto; padding: 4.5rem 1.4rem 4rem; }
    .mark {
      width: 2.4rem;
      height: 2.4rem;
      margin-bottom: 1.4rem;
      border-radius: 0.8rem;
      background: linear-gradient(160deg, #f3d7b0, #c4864a 48%, #6e8aab);
      box-shadow: 0 10px 30px rgba(196, 134, 74, 0.28);
    }
    h1 {
      margin: 0;
      font-family: Palatino, "Palatino Linotype", Georgia, serif;
      font-size: clamp(2.4rem, 6vw, 3.6rem);
      font-weight: 500;
      letter-spacing: -0.04em;
      line-height: 1.05;
    }
    .lead { max-width: 34rem; margin: 0.9rem 0 0; color: #c9beb4; font-size: 1.05rem; line-height: 1.6; }
    .panel {
      margin-top: 2rem;
      padding: 1.15rem;
      border: 1px solid rgba(246, 241, 234, 0.1);
      border-radius: 1.3rem;
      background: rgba(22, 20, 18, 0.86);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
    }
    form { display: grid; gap: 0.75rem; }
    .language { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; margin: 0; }
    .language span { font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; color: #b7aa9e; }
    .choice {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.32rem 0.72rem;
      border: 1px solid rgba(246, 241, 234, 0.14);
      border-radius: 999px;
      color: #c9beb4;
      cursor: pointer;
    }
    .choice:has(input:checked) { border-color: transparent; background: #f3d7b0; color: #2a160c; }
    .choice input { margin: 0; accent-color: #2a160c; }
    label { font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; color: #b7aa9e; }
    .controls { display: flex; gap: 0.7rem; }
    input {
      flex: 1;
      min-width: 0;
      font: inherit;
      color: #f6f1ea;
      padding: 0.9rem 1rem;
      border: 1px solid rgba(246, 241, 234, 0.14);
      border-radius: 0.9rem;
      background: #0f0e0c;
    }
    input:focus { outline: 2px solid #d4a574; outline-offset: 2px; }
    button {
      font: inherit;
      padding: 0.9rem 1.15rem;
      border: 0;
      border-radius: 0.9rem;
      background: #f3d7b0;
      color: #2a160c;
      font-weight: 650;
      cursor: pointer;
    }
    button:hover { background: #ffe7c7; }
    button:disabled { opacity: 0.55; cursor: wait; }
    button.again {
      margin-top: 0.15rem;
      padding: 0.35rem 0.75rem;
      border: 1px solid rgba(243, 215, 176, 0.35);
      background: transparent;
      color: #f3d7b0;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    button.again:hover { background: rgba(243, 215, 176, 0.12); }
    .hint { margin: 0.85rem 0 0; color: #8f847a; font-size: 0.92rem; line-height: 1.55; }
    #result { min-height: 1.4rem; margin: 1rem 0 0; }
    #result.banner {
      padding: 0.85rem 1rem;
      border-radius: 0.9rem;
      background: rgba(243, 215, 176, 0.1);
      border: 1px solid rgba(243, 215, 176, 0.2);
    }
    #result.banner.error {
      background: rgba(243, 180, 174, 0.12);
      border-color: rgba(243, 180, 174, 0.4);
    }
    h2 { margin: 2.4rem 0 0.9rem; font-size: 0.82rem; letter-spacing: 0.12em; text-transform: uppercase; color: #b7aa9e; font-weight: 650; }
    .jobs { display: grid; gap: 0.8rem; }
    article {
      padding: 1rem 1.05rem 1.05rem;
      border-radius: 1.1rem;
      border: 1px solid rgba(246, 241, 234, 0.08);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015));
    }
    article p { margin: 0.45rem 0 0.7rem; color: #b7aa9e; line-height: 1.5; }
    ul { margin: 0 0 0.8rem; padding-left: 1.15rem; }
    li { margin: 0.28rem 0; line-height: 1.45; }
    .row { display: flex; justify-content: space-between; gap: 0.8rem; align-items: center; }
    strong { font-weight: 620; letter-spacing: -0.02em; }
    .status { border-radius: 999px; padding: 0.22rem 0.65rem; font-size: 0.78rem; letter-spacing: 0.02em; color: #1c140f; background: #d9cfc4; white-space: nowrap; }
    .status.running, .status.pending { background: #f3d7b0; }
    .status.done { background: #b7e4c7; }
    .status.failed { background: #f3b4ae; }
    a { color: #f3d7b0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .card-actions { display: flex; flex-wrap: wrap; gap: 0.85rem 1rem; align-items: center; }
    .empty { color: #8f847a; }
    @media (max-width: 640px) {
      .controls { flex-direction: column; }
      main { padding-top: 2.6rem; }
    }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true"></div>
    <h1>AI 리뷰 봇</h1>
    <p class="lead">Pull Request 주소를 붙여 넣으면 리뷰를 시작하고, 끝나면 GitHub에 댓글을 남깁니다.</p>
    <section class="panel">
      <form id="review-form">
        <label for="pull-request-url">리뷰할 Pull Request</label>
        <div class="language" role="radiogroup" aria-labelledby="language-label">
          <span id="language-label">댓글 언어</span>
          <label class="choice"><input type="radio" name="language" value="ko" checked> 한국어</label>
          <label class="choice"><input type="radio" name="language" value="en"> English</label>
        </div>
        <div class="controls">
          <input id="pull-request-url" name="pullRequestUrl" type="text" required placeholder="github.com/owner/repo/pull/1" autocomplete="off" spellcheck="false">
          <button type="submit">리뷰 요청</button>
        </div>
      </form>
      <p class="hint">github.com/owner/repo/pull/1, owner/repo/pull/1, owner/repo#1 중 편한 형식으로 넣으면 됩니다. 고른 언어로 GitHub 댓글이 달립니다. 초안과 닫힌 Pull Request는 리뷰하지 않습니다. Webhook으로 시작된 리뷰는 한국어입니다.</p>
      <p id="result" role="status"></p>
    </section>
    <h2>최근 리뷰</h2>
    <div id="jobs" aria-live="polite"></div>
  </main>
  <script>
    // 서버가 준 작업 기록만 그린다. 주소와 제목은 textContent로 넣어 HTML로 해석하지 않는다.
    const form = document.querySelector("#review-form");
    const input = document.querySelector("#pull-request-url");
    const result = document.querySelector("#result");
    const jobs = document.querySelector("#jobs");
    const labels = {
      pending: "곧 시작",
      running: "분석 중",
      done: "댓글 등록됨",
      failed: "실패",
      superseded: "새 커밋으로 대체됨",
    };
    const severityLabels = { critical: "치명", high: "높음", medium: "중간", low: "낮음" };
    const skipReasons = {
      draft: "초안이라 댓글을 남기지 않았습니다.",
      "stale-head": "더 새로운 커밋이 있어 이 리뷰는 올리지 않았습니다.",
      duplicate: "같은 커밋에는 이미 리뷰가 있습니다.",
    };

    function safePullUrl(job) {
      const safeName = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
      if (!safeName.test(job.owner) || !safeName.test(job.repo) || !Number.isInteger(job.pullNumber)) {
        return "";
      }
      const base = "https://github.com/" + job.owner + "/" + job.repo + "/pull/" + job.pullNumber;
      const reviewId = job.summary && job.summary.reviewId;
      if (Number.isInteger(reviewId) && reviewId > 0) {
        return base + "#pullrequestreview-" + reviewId;
      }
      return base;
    }

    function countLine(summary) {
      const parts = [];
      for (const key of ["critical", "high", "medium", "low"]) {
        if (summary.counts && summary.counts[key] > 0) {
          parts.push(severityLabels[key] + " " + summary.counts[key]);
        }
      }
      return parts.length === 0 ? "지적 없음" : parts.join(" · ");
    }

    function describe(job) {
      const summary = job.summary;
      if (!summary) {
        if (job.status === "pending") return { label: labels.pending, tone: "pending", text: "잠시 후 분석을 시작합니다. 이 화면은 자동으로 갱신됩니다." };
        if (job.status === "running") return { label: labels.running, tone: "running", text: "분석이 끝나면 GitHub Pull Request에 댓글이 달립니다." };
        if (job.status === "failed") return { label: labels.failed, tone: "failed", text: "같은 주소로 다시 요청할 수 있습니다." };
        if (job.status === "superseded") return { label: labels.superseded, tone: "superseded", text: "같은 Pull Request의 더 새로운 커밋을 리뷰합니다." };
        return { label: "완료", tone: "done", text: "GitHub에서 리뷰 댓글을 볼 수 있습니다." };
      }
      if (summary.outcome === "posted") {
        const line = countLine(summary);
        return {
          label: line === "지적 없음" ? "지적 없음" : "댓글 등록됨",
          tone: "done",
          text: (summary.partialFailure ? "일부 분석은 완료하지 못했습니다. " : "") + line,
        };
      }
      if (summary.outcome === "skipped") {
        return { label: "올리지 않음", tone: "superseded", text: skipReasons[summary.reason] || "이 리뷰는 댓글로 남기지 않았습니다." };
      }
      if (summary.outcome === "agents-failed") {
        return { label: "실패", tone: "failed", text: "분석을 완료하지 못해 댓글을 남기지 않았습니다." };
      }
      return { label: "실패", tone: "failed", text: "리뷰 중 오류가 났습니다. 같은 주소로 다시 요청할 수 있습니다." };
    }
    function whenText(updatedAt) {
      const parsed = new Date(updatedAt);
      if (Number.isNaN(parsed.getTime())) {
        return "";
      }
      const minutes = Math.round((Date.now() - parsed.getTime()) / 60000);
      if (minutes < 1) {
        return "방금";
      }
      if (minutes < 60) {
        return minutes + "분 전";
      }
      if (minutes < 60 * 24) {
        return Math.round(minutes / 60) + "시간 전";
      }
      return parsed.toLocaleString();
    }

    function latestJobs(list) {
      const seen = new Set();
      const latest = [];
      for (const job of list) {
        const key = job.owner + "/" + job.repo + "#" + job.pullNumber;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        latest.push(job);
      }
      return latest;
    }

    function languageText(language) {
      if (language === "en") return "English";
      if (language === "ko") return "한국어";
      return "";
    }

    function selectedLanguage() {
      const chosen = form.querySelector("input[name=language]:checked");
      return chosen && chosen.value === "en" ? "en" : "ko";
    }

    function rememberLanguage() {
      try {
        sessionStorage.setItem("review-bot-language", selectedLanguage());
      } catch {
        /* 저장소를 쓸 수 없어도 요청은 계속한다. */
      }
    }

    function restoreLanguage() {
      let saved = "";
      try {
        saved = sessionStorage.getItem("review-bot-language") || "";
      } catch {
        saved = "";
      }
      const value = saved === "en" ? "en" : "ko";
      const choice = form.querySelector('input[name="language"][value="' + value + '"]');
      if (choice) {
        choice.checked = true;
      }
    }

    function shortSha(headSha) {
      return typeof headSha === "string" && /^[0-9a-f]{7,64}$/i.test(headSha) ? headSha.slice(0, 7) : "";
    }

    function remember(value) {
      try {
        sessionStorage.setItem("review-bot-url", value);
      } catch {
        /* 저장소를 쓸 수 없어도 요청은 계속한다. */
      }
    }

    function remembered() {
      try {
        return sessionStorage.getItem("review-bot-url") || "";
      } catch {
        return "";
      }
    }

    function fillRequest(job) {
      const safeName = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
      if (!safeName.test(job.owner) || !safeName.test(job.repo) || !Number.isInteger(job.pullNumber)) {
        return;
      }
      input.value = job.owner + "/" + job.repo + "#" + job.pullNumber;
      remember(input.value);
      input.focus();
      showResult("주소를 넣었습니다. 리뷰 요청을 누르면 다시 분석합니다.");
      form.scrollIntoView({ block: "center" });
    }

    function render(list) {
      jobs.replaceChildren();
      const items = latestJobs(Array.isArray(list) ? list : []);
      if (items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "아직 리뷰가 없습니다. 위에서 Pull Request 주소를 넣어 주세요.";
        jobs.append(empty);
        return;
      }
      const board = document.createElement("div");
      board.className = "jobs";
      for (const job of items) {
        const card = document.createElement("article");
        const row = document.createElement("div");
        row.className = "row";
        const view = describe(job);
        const href = safePullUrl(job);
        const title = href === "" ? document.createElement("strong") : document.createElement("a");
        title.textContent = job.owner + "/" + job.repo + " #" + job.pullNumber;
        if (href !== "") {
          title.href = href;
        }
        const badge = document.createElement("span");
        badge.className = "status " + view.tone;
        badge.textContent = view.label;
        row.append(title, badge);
        const detail = document.createElement("p");
        const sha = shortSha(job.headSha);
        const when = whenText(job.updatedAt);
        detail.textContent = [view.text, languageText(job.language), sha === "" ? "" : "커밋 " + sha, when].filter((part) => part !== "").join(" · ");
        card.append(row, detail);
        const highlights = job.summary && Array.isArray(job.summary.highlights) ? job.summary.highlights : [];
        if (highlights.length > 0) {
          const list = document.createElement("ul");
          for (const finding of highlights) {
            const item = document.createElement("li");
            const severity = severityLabels[finding.severity] || "";
            item.textContent = severity + " · " + finding.title + " · " + finding.filePath;
            list.append(item);
          }
          card.append(list);
        }
        const actions = document.createElement("div");
        actions.className = "card-actions";
        if (href !== "") {
          const link = document.createElement("a");
          link.href = href;
          link.textContent = "GitHub에서 댓글 보기";
          actions.append(link);
        }
        const again = document.createElement("button");
        again.type = "button";
        again.className = "again";
        again.textContent = "다시 리뷰";
        again.addEventListener("click", () => fillRequest(job));
        actions.append(again);
        card.append(actions);
        board.append(card);
      }
      jobs.append(board);
    }

    function showResult(message, href, tone) {
      result.className = tone === "error" ? "banner error" : "banner";
      result.replaceChildren();
      result.append(document.createTextNode(message));
      if (href) {
        result.append(document.createTextNode(" "));
        const link = document.createElement("a");
        link.href = href;
        link.textContent = "GitHub에서 댓글 보기";
        result.append(link);
      }
    }

    let lastJobs = "";

    async function loadJobs() {
      const response = await fetch("/console/jobs");
      if (!response.ok) {
        return;
      }
      const body = await response.json();
      const next = JSON.stringify(body.jobs);
      if (next === lastJobs) {
        return;
      }
      lastJobs = next;
      render(body.jobs);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      const idleLabel = button.textContent;
      input.value = input.value.trim();
      remember(input.value);
      rememberLanguage();
      button.disabled = true;
      button.textContent = "요청 중";
      showResult("리뷰를 등록하는 중입니다.");
      try {
        const response = await fetch("/console/reviews", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pullRequestUrl: input.value, language: selectedLanguage() }),
        });
        const body = await response.json();
        if (!response.ok) {
          showResult(body.error && body.error.message ? body.error.message : "리뷰를 시작하지 못했습니다.", undefined, "error");
          return;
        }
        showResult("리뷰를 시작했습니다. 이 화면이 끝나면 결과로 바뀌고, GitHub에도 댓글이 달립니다.", safePullUrl(body.job));
        await loadJobs();
      } catch {
        showResult("서버에 연결하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", undefined, "error");
      } finally {
        button.disabled = false;
        button.textContent = idleLabel;
      }
    });

    const saved = remembered().trim();
    if (saved !== "" && saved.length <= 500) {
      input.value = saved;
    }
    restoreLanguage();
    for (const choice of form.querySelectorAll("input[name=language]")) {
      choice.addEventListener("change", rememberLanguage);
    }
    input.focus();
    loadJobs();
    setInterval(loadJobs, 4000);
  </script>
</body>
</html>
`;
