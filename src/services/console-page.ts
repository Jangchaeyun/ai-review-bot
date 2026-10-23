/**
 * 브라우저 콘솔 한 페이지. 리뷰 요청은 로그인한 사용자만 할 수 있다.
 * 가입은 회사 대표와 사원 중 하나를 고르고, 부서는 목록에서만 고른다.
 * 초대 코드 복사가 막히면 코드 글을 선택해 직접 복사할 수 있게 한다.
 * 최근 카드는 같은 Pull Request의 최신 작업만 보여주고, 지적 본문은 저장하지 않는다.
 */
import { DEPARTMENTS } from "./account-store.js";

/** 가입과 사원 정보 화면이 같은 부서 목록을 쓰도록 옵션 HTML을 만든다. */
const departmentOptions = DEPARTMENTS.map((name) => `<option value="${name}">${name}</option>`).join("");

export const CONSOLE_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 리뷰 봇</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI Variable", "Segoe UI", sans-serif;
      color: #1f1a16;
      background: #f3efe9;
    }
    main { max-width: 32rem; margin: 0 auto; padding: 2rem 1rem 3rem; }
    .top { margin-bottom: 0.25rem; }
    h1 { margin: 0; font-size: 1.7rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1.2; }
    .lead { margin: 0.4rem 0 0; color: #5f574f; font-size: 0.98rem; line-height: 1.5; }
    .panel {
      margin-top: 1.15rem;
      padding: 1.15rem;
      border: 1px solid #e4dcd2;
      border-radius: 1rem;
      background: #fff;
    }
    form, .stack { display: grid; gap: 0.9rem; }
    .tabs, .segment-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; padding: 0.25rem; border-radius: 0.8rem; background: #f3efe9; }
    .segment { display: grid; gap: 0.4rem; }
    .tabs button, .choice {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 2.7rem;
      border: 0;
      border-radius: 0.6rem;
      background: transparent;
      color: #1f1a16;
      font-weight: 600;
    }
    .tabs button[aria-selected="true"], .choice:has(input:checked) { background: #1f1a16; color: #fff; }
    .choice { position: relative; cursor: pointer; }
    .choice input {
      position: absolute;
      width: 1px;
      height: 1px;
      min-height: 0;
      margin: 0;
      opacity: 0;
    }
    .group { display: grid; gap: 0.8rem; margin: 0; padding: 0.15rem 0 0; border-top: 1px solid #efe8e0; }
    .group-title { margin: 0.15rem 0 0; color: #6f655c; font-size: 0.84rem; font-weight: 700; }
    .field { display: grid; gap: 0.3rem; }
    label { color: #1f1a16; font-size: 0.92rem; font-weight: 650; }
    .field-hint, .hint { margin: 0; color: #6f655c; font-size: 0.88rem; line-height: 1.45; }
    .controls { display: flex; gap: 0.5rem; }
    input, select {
      width: 100%;
      min-width: 0;
      min-height: 2.75rem;
      font: inherit;
      color: #1f1a16;
      padding: 0.7rem 0.85rem;
      border: 1px solid #d9d0c6;
      border-radius: 0.7rem;
      background: #fff;
    }
    select { cursor: pointer; }
    input::placeholder { color: #9a9188; }
    input:focus, select:focus, button:focus-visible, .choice:focus-within { outline: 2px solid #1f1a16; outline-offset: 2px; }
    button {
      font: inherit;
      min-height: 2.75rem;
      padding: 0.7rem 1rem;
      border: 0;
      border-radius: 0.7rem;
      background: #1f1a16;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
    }
    .stack > button { width: 100%; }
    button:hover { background: #3a312b; }
    button:disabled { opacity: 0.55; cursor: wait; }
    button.again, button.ghost {
      min-height: 2.4rem;
      padding: 0.4rem 0.8rem;
      border: 1px solid #d9d0c6;
      background: #fff;
      color: #1f1a16;
      font-size: 0.92rem;
      font-weight: 650;
    }
    button.again:hover, button.ghost:hover { background: #f3efe9; }
    .banner {
      margin-top: 0.85rem;
      padding: 0.8rem 0.9rem;
      border-radius: 0.7rem;
      background: #f3efe9;
      border: 1px solid #e4dcd2;
      color: #1f1a16;
    }
    .banner.error { background: #fde8e4; border-color: #e7b2a8; }
    #account-result:empty, #result:empty { display: none; }
    h2 { margin: 1.4rem 0 0.7rem; font-size: 1.05rem; font-weight: 700; color: #1f1a16; }
    .panel h2 { margin: 0 0 0.7rem; }
    .jobs { display: grid; gap: 0.7rem; }
    article {
      padding: 0.95rem 1rem;
      border-radius: 0.9rem;
      border: 1px solid #e4dcd2;
      background: #fff;
    }
    article p { margin: 0.5rem 0 0.7rem; color: #5f574f; line-height: 1.5; }
    ul { margin: 0; padding: 0; list-style: none; }
    #member-list { display: grid; gap: 0.4rem; }
    li { margin: 0; padding: 0.7rem 0.85rem; border-radius: 0.7rem; background: #f7f4ef; line-height: 1.45; }
    .row { display: flex; justify-content: space-between; gap: 0.8rem; align-items: center; }
    strong { font-weight: 700; }
    .status { border-radius: 999px; padding: 0.25rem 0.65rem; font-size: 0.8rem; color: #1c140f; background: #e7e1d8; white-space: nowrap; }
    .status.running, .status.pending { background: #f3d7b0; }
    .status.done { background: #cfeedd; }
    .status.failed { background: #f6cfc9; }
    a { color: #8a4b24; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .card-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    .empty { color: #6f655c; padding: 1rem; border: 1px dashed #d9d0c6; border-radius: 0.8rem; background: #fff; }
    .session {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.8rem;
      margin-top: 1.15rem;
      padding: 0.9rem 1rem;
      border-radius: 1rem;
      border: 1px solid #e4dcd2;
      background: #fff;
    }
    .eyebrow { margin: 0; color: #6f655c; font-size: 0.84rem; }
    #session-name, #company-title { margin: 0.15rem 0 0; color: #1f1a16; font-size: 1.02rem; line-height: 1.45; }
    #company-title { margin: 0 0 0.85rem; }
    .invite {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.8rem;
      margin-bottom: 0.9rem;
      padding: 0.85rem 0.9rem;
      border-radius: 0.8rem;
      background: #f7f4ef;
    }
    #invite-code { display: block; margin-top: 0.15rem; color: #1f1a16; font-size: 1.2rem; letter-spacing: 0.04em; user-select: all; }
    [hidden] { display: none !important; }
    @media (max-width: 640px) {
      .controls, .session, .invite { flex-direction: column; align-items: stretch; }
      .controls button, .session button, .invite .card-actions button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <header class="top">
      <h1>AI 리뷰 봇</h1>
      <p class="lead">회사 대표는 회사를 등록하고, 사원은 초대 코드로 들어옵니다.</p>
    </header>
    <section class="panel" id="account-panel">
      <div class="tabs" role="tablist" aria-label="계정">
        <button id="show-signup" type="button" role="tab" aria-selected="true" aria-controls="signup-form">회원가입</button>
        <button id="show-login" type="button" role="tab" aria-selected="false" aria-controls="login-form">로그인</button>
      </div>
      <form id="signup-form" class="stack">
        <div class="segment" role="radiogroup" aria-labelledby="signup-position-label">
          <span id="signup-position-label" class="group-title">가입 구분</span>
          <div class="segment-row">
            <label class="choice"><input type="radio" name="position" value="representative" checked> 회사 대표</label>
            <label class="choice"><input type="radio" name="position" value="employee"> 사원</label>
          </div>
        </div>
        <p id="position-help" class="hint">회사를 등록하면 관리자가 되고 초대 코드를 받습니다.</p>
        <div id="company-fields" class="group">
          <p class="group-title">회사</p>
          <div class="field">
            <label for="signup-company">회사 이름</label>
            <input id="signup-company" name="companyName" type="text" required minlength="2" maxlength="40" autocomplete="organization" spellcheck="false">
          </div>
          <div class="field">
            <label for="signup-business">사업자등록번호</label>
            <input id="signup-business" name="businessNumber" type="text" required minlength="10" maxlength="12" inputmode="numeric" autocomplete="off" placeholder="000-00-00000" spellcheck="false">
          </div>
          <div class="field">
            <label for="signup-representative">대표자</label>
            <input id="signup-representative" name="representative" type="text" required minlength="2" maxlength="40" autocomplete="name" spellcheck="false">
            <p class="field-hint">사업자등록증의 이름입니다.</p>
          </div>
        </div>
        <div id="invite-fields" class="group" hidden>
          <p class="group-title">초대</p>
          <div class="field">
            <label for="signup-invite">초대 코드</label>
            <input id="signup-invite" name="inviteCode" type="text" minlength="10" maxlength="16" autocomplete="off" spellcheck="false">
            <p class="field-hint">관리자에게 받은 10자리 코드입니다.</p>
          </div>
        </div>
        <div class="group">
          <p class="group-title">내 정보</p>
          <div class="field">
            <label for="signup-employee">사원번호</label>
            <input id="signup-employee" name="employeeNumber" type="text" required minlength="1" maxlength="20" autocomplete="off" spellcheck="false">
          </div>
          <div class="field">
            <label for="signup-department">부서</label>
            <select id="signup-department" name="department" autocomplete="organization">
              <option value="">선택 안 함</option>
              ${departmentOptions}
            </select>
          </div>
          <div class="field">
            <label for="signup-username">사용자 이름</label>
            <input id="signup-username" name="username" type="text" required minlength="2" maxlength="32" autocomplete="username" spellcheck="false">
          </div>
          <div class="field">
            <label for="signup-password">비밀번호</label>
            <input id="signup-password" name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password">
            <p class="field-hint">8자 이상입니다.</p>
          </div>
        </div>
        <button type="submit">가입</button>
      </form>
      <form id="login-form" class="stack" hidden>
        <div class="field">
          <label for="login-username">사용자 이름</label>
          <input id="login-username" name="username" type="text" required minlength="2" maxlength="32" autocomplete="username" spellcheck="false">
        </div>
        <div class="field">
          <label for="login-password">비밀번호</label>
          <input id="login-password" name="password" type="password" required minlength="8" maxlength="72" autocomplete="current-password">
        </div>
        <button type="submit">로그인</button>
      </form>
      <p id="account-result" role="status"></p>
    </section>
    <div id="workspace" hidden>
    <header class="session">
      <div>
        <p class="eyebrow">로그인됨</p>
        <p id="session-name"></p>
      </div>
      <button id="logout" class="ghost" type="button">로그아웃</button>
    </header>
    <section class="panel" id="company-panel">
      <h2>회사</h2>
      <p id="company-title"></p>
      <form id="rename-form" class="stack" hidden>
        <div class="field">
          <label for="rename-company">회사 이름</label>
          <input id="rename-company" name="name" type="text" minlength="2" maxlength="40" autocomplete="organization">
        </div>
        <div class="field">
          <label for="rename-business">사업자등록번호</label>
          <input id="rename-business" name="businessNumber" type="text" minlength="10" maxlength="12" inputmode="numeric" placeholder="000-00-00000" autocomplete="off">
        </div>
        <div class="field">
          <label for="rename-representative">대표자</label>
          <input id="rename-representative" name="representative" type="text" minlength="2" maxlength="40" autocomplete="name">
        </div>
        <button type="submit">회사 등록</button>
      </form>
      <form id="profile-form" class="stack" hidden>
        <div class="field">
          <label for="profile-employee">사원번호</label>
          <input id="profile-employee" name="employeeNumber" type="text" required minlength="1" maxlength="20" autocomplete="off">
        </div>
        <div class="field">
          <label for="profile-department">부서</label>
          <select id="profile-department" name="department" autocomplete="organization">
            <option value="">선택 안 함</option>
            ${departmentOptions}
          </select>
        </div>
        <button type="submit">사원 정보 등록</button>
      </form>
      <div id="invite-line" class="invite" hidden>
        <div>
          <p class="group-title">초대 코드</p>
          <strong id="invite-code"></strong>
        </div>
        <div class="card-actions">
          <button id="copy-invite" class="ghost" type="button">복사</button>
          <button id="rotate-invite" class="ghost" type="button">코드 바꾸기</button>
        </div>
      </div>
      <p class="group-title">구성원</p>
      <ul id="member-list"></ul>
    </section>
    <section class="panel">
      <h2>리뷰 요청</h2>
      <form id="review-form" class="stack">
        <div class="segment" role="radiogroup" aria-labelledby="language-label">
          <span id="language-label" class="group-title">댓글 언어</span>
          <div class="segment-row">
            <label class="choice"><input type="radio" name="language" value="ko" checked> 한국어</label>
            <label class="choice"><input type="radio" name="language" value="en"> English</label>
          </div>
        </div>
        <div class="field">
          <label for="pull-request-url">리뷰할 Pull Request</label>
          <div class="controls">
            <input id="pull-request-url" name="pullRequestUrl" type="text" required placeholder="github.com/owner/repo/pull/1" autocomplete="off" spellcheck="false">
            <button type="submit">리뷰 요청</button>
          </div>
          <p class="field-hint">github.com/owner/repo/pull/1, owner/repo/pull/1, owner/repo#1 형식을 쓸 수 있습니다.</p>
        </div>
      </form>
      <p class="hint">고른 언어로 GitHub 댓글이 달립니다. 초안과 닫힌 Pull Request는 리뷰하지 않습니다. Webhook으로 시작된 리뷰는 한국어입니다.</p>
      <p id="result" role="status"></p>
    </section>
    <h2>최근 리뷰</h2>
    <div id="jobs" aria-live="polite"></div>
    </div>
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
        const requester = typeof job.requestedBy === "string" && /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣_-]{1,31}$/.test(job.requestedBy) ? "요청 " + job.requestedBy : "";
        detail.textContent = [view.text, requester, languageText(job.language), sha === "" ? "" : "커밋 " + sha, when].filter((part) => part !== "").join(" · ");
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
      if (response.status === 401) {
        leaveWorkspace();
        return;
      }
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
          if (response.status === 401) {
            workspace.hidden = true;
            accountPanel.hidden = false;
          }
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

    const accountPanel = document.querySelector("#account-panel");
    const accountResult = document.querySelector("#account-result");
    const workspace = document.querySelector("#workspace");
    const sessionName = document.querySelector("#session-name");
    const signupForm = document.querySelector("#signup-form");
    const loginForm = document.querySelector("#login-form");
    const companyTitle = document.querySelector("#company-title");
    const renameForm = document.querySelector("#rename-form");
    const profileForm = document.querySelector("#profile-form");
    const inviteLine = document.querySelector("#invite-line");
    const inviteCode = document.querySelector("#invite-code");
    const memberList = document.querySelector("#member-list");
    let polling = false;
    let pollTimer = 0;

    function showAccount(message, tone) {
      accountResult.className = tone === "error" ? "banner error" : "banner";
      accountResult.textContent = message;
    }

    // 회사 대표는 회사 정보만, 사원은 초대 코드만 보여 준다.
    function applySignupPosition(position) {
      const representative = position === "representative";
      const companyFields = document.querySelector("#company-fields");
      const inviteFields = document.querySelector("#invite-fields");
      companyFields.hidden = !representative;
      inviteFields.hidden = representative;
      signupForm.companyName.hidden = !representative;
      signupForm.companyName.required = representative;
      signupForm.businessNumber.hidden = !representative;
      signupForm.businessNumber.required = representative;
      signupForm.representative.hidden = !representative;
      signupForm.representative.required = representative;
      signupForm.inviteCode.hidden = representative;
      signupForm.inviteCode.required = !representative;
      const positionHelp = document.querySelector("#position-help");
      positionHelp.textContent = representative
        ? "회사를 등록하면 관리자가 되고 초대 코드를 받습니다."
        : "관리자에게 받은 초대 코드를 입력하면 구성원으로 가입합니다.";
    }

    const signupTab = document.querySelector("#show-signup");
    const loginTab = document.querySelector("#show-login");
    function showAuthTab(name) {
      const signup = name !== "login";
      signupForm.hidden = !signup;
      loginForm.hidden = signup;
      signupTab.setAttribute("aria-selected", signup ? "true" : "false");
      loginTab.setAttribute("aria-selected", signup ? "false" : "true");
    }
    signupTab.addEventListener("click", () => {
      showAuthTab("signup");
    });
    loginTab.addEventListener("click", () => {
      showAuthTab("login");
    });

    // 회사가 없으면 회사 대표, 있으면 사원을 기본으로 고른다.
    function showSignupMode(registered) {
      const position = registered ? "employee" : "representative";
      const selected = signupForm.querySelector("input[name=position][value=" + position + "]");
      if (selected) {
        selected.checked = true;
      }
      applySignupPosition(position);
    }

    for (const choice of signupForm.querySelectorAll("input[name=position]")) {
      choice.addEventListener("change", () => {
        if (choice.checked) {
          applySignupPosition(choice.value);
        }
      });
    }

    function stopPolling() {
      if (pollTimer !== 0) {
        clearInterval(pollTimer);
        pollTimer = 0;
      }
      polling = false;
    }

    function leaveWorkspace(message) {
      stopPolling();
      workspace.hidden = true;
      accountPanel.hidden = false;
      sessionName.textContent = "";
      companyTitle.textContent = "";
      inviteCode.textContent = "";
      inviteLine.hidden = true;
      renameForm.hidden = true;
      profileForm.hidden = true;
      profileForm.employeeNumber.value = "";
      profileForm.department.value = "";
      memberList.replaceChildren();
      jobs.replaceChildren();
      lastJobs = "";
      if (message) {
        showAccount(message);
      }
      showAuthTab("login");
      showSignupMode(false);
      fetch("/account/setup").then(async (response) => {
        if (!response.ok) {
          return;
        }
        const body = await response.json();
        showSignupMode(body.companyRegistered === true);
      }).catch(() => undefined);
    }

    function roleText(role) {
      return role === "admin" ? "관리자" : "구성원";
    }

    // 가입 때 고른 구분을 보여 준다. 예전 사용자는 구분이 없어 역할 이름으로 대신한다.
    function identityText(role, position) {
      if (position === "representative") {
        return "회사 대표";
      }
      if (position === "employee") {
        return "사원";
      }
      return roleText(role);
    }

    async function loadCompany() {
      const response = await fetch("/account/company");
      if (!response.ok) {
        return;
      }
      const body = await response.json();
      const registered = body.registered === true;
      let title = registered ? body.name : "회사 이름 없음";
      if (registered && typeof body.businessNumber === "string") {
        title += " · " + body.businessNumber;
      }
      if (registered && typeof body.representative === "string") {
        title += " · 대표 " + body.representative;
      }
      companyTitle.textContent = title + " · " + identityText(body.role, body.position);
      memberList.replaceChildren();
      const members = Array.isArray(body.members) ? body.members : [];
      for (const member of members) {
        const item = document.createElement("li");
        let text = member.username + " · " + identityText(member.role, member.position);
        if (typeof member.employeeNumber === "string") {
          text += " · " + member.employeeNumber;
        }
        if (typeof member.department === "string") {
          text += " · " + member.department;
        }
        item.textContent = text;
        memberList.append(item);
      }
      if (typeof body.inviteCode === "string") {
        inviteCode.textContent = body.inviteCode;
        inviteLine.hidden = false;
        renameForm.hidden = registered;
        if (!registered) {
          renameForm.name.value = "";
        }
      } else {
        inviteCode.textContent = "";
        inviteLine.hidden = true;
        renameForm.hidden = true;
      }
    }

    function enterWorkspace(user) {
      accountPanel.hidden = true;
      workspace.hidden = false;
      const username = user && user.username ? user.username : "";
      const companyName = user && user.companyName ? user.companyName : "";
      const role = identityText(user && user.role, user && user.position);
      sessionName.textContent = companyName === "" ? username + " · " + role : companyName + " · " + username + " · " + role;
      profileForm.hidden = typeof user.employeeNumber === "string";
      void loadCompany();
      if (!polling) {
        polling = true;
        loadJobs();
        pollTimer = setInterval(loadJobs, 4000);
      }
    }

    async function submitAccount(path, accountForm) {
      const username = accountForm.username.value.trim();
      const password = accountForm.password.value;
      const payload = { username, password };
      if (path === "/account/signup") {
        payload.employeeNumber = accountForm.employeeNumber.value.trim();
        const department = accountForm.department.value.trim();
        if (department !== "") {
          payload.department = department;
        }
        const selected = accountForm.querySelector("input[name=position]:checked");
        const position = selected ? selected.value : "representative";
        payload.position = position;
        if (position === "representative") {
          payload.companyName = accountForm.companyName.value.trim();
          payload.businessNumber = accountForm.businessNumber.value.trim();
          payload.representative = accountForm.representative.value.trim();
        }
        if (position === "employee") {
          payload.inviteCode = accountForm.inviteCode.value.trim();
        }
      }
      accountForm.querySelector("button").disabled = true;
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) {
          showAccount(body.error && body.error.message ? body.error.message : "처리하지 못했습니다.", "error");
          return;
        }
        accountForm.password.value = "";
        enterWorkspace(body.user && body.user.username ? body.user : { username });
      } catch {
        showAccount("서버에 연결하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", "error");
      } finally {
        accountForm.querySelector("button").disabled = false;
      }
    }

    signupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitAccount("/account/signup", signupForm);
    });
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitAccount("/account/login", loginForm);
    });
    document.querySelector("#logout").addEventListener("click", async () => {
      await fetch("/account/logout", { method: "POST" });
      leaveWorkspace("로그아웃했습니다.");
    });
    renameForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await fetch("/account/company", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: renameForm.name.value.trim(),
          businessNumber: renameForm.businessNumber.value.trim(),
          representative: renameForm.representative.value.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        showResult(body.error && body.error.message ? body.error.message : "회사를 등록하지 못했습니다.", undefined, "error");
        return;
      }
      await loadCompany();
      const current = sessionName.textContent || "";
      const parts = current.split(" · ");
      if (parts.length >= 2 && typeof body.name === "string") {
        parts[0] = body.name;
        sessionName.textContent = parts.join(" · ");
      }
    });
    profileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const department = profileForm.department.value.trim();
      const payload = { employeeNumber: profileForm.employeeNumber.value.trim() };
      if (department !== "") {
        payload.department = department;
      }
      const response = await fetch("/account/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        showResult(body.error && body.error.message ? body.error.message : "사원 정보를 등록하지 못했습니다.", undefined, "error");
        return;
      }
      profileForm.hidden = true;
      profileForm.employeeNumber.value = "";
      profileForm.department.value = "";
      await loadCompany();
    });
    // 클립보드 API가 거절되면 숨은 입력으로 다시 복사한다.
    function copyInviteWithField(code) {
      const field = document.createElement("textarea");
      field.value = code;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.top = "0";
      field.style.left = "0";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.focus();
      field.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      field.remove();
      return copied;
    }
    // 복사 명령까지 실패하면 초대 코드 글을 선택해 직접 복사할 수 있게 한다.
    function selectInviteCode() {
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(inviteCode);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.querySelector("#copy-invite").addEventListener("click", async () => {
      const code = inviteCode.textContent || "";
      const copyButton = document.querySelector("#copy-invite");
      if (code === "" || !copyButton) {
        return;
      }
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code);
          copied = true;
        }
      } catch {
        copied = false;
      }
      if (!copied) {
        copied = copyInviteWithField(code);
      }
      if (!copied) {
        selectInviteCode();
      }
      copyButton.textContent = copied ? "복사됨" : "선택됨";
      setTimeout(() => {
        copyButton.textContent = "복사";
      }, 1600);
    });
    document.querySelector("#rotate-invite").addEventListener("click", async () => {
      const response = await fetch("/account/company/invite", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        showResult(body.error && body.error.message ? body.error.message : "초대 코드를 바꾸지 못했습니다.", undefined, "error");
        return;
      }
      if (typeof body.inviteCode === "string") {
        inviteCode.textContent = body.inviteCode;
        inviteLine.hidden = false;
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
    fetch("/account/me").then(async (response) => {
      if (response.status === 401) {
        return;
      }
      if (!response.ok) {
        showAccount("로그인 상태를 확인하지 못했습니다.", "error");
        return;
      }
      const body = await response.json();
      if (body.user && body.user.username) {
        enterWorkspace(body.user);
      }
    }).catch(() => {
      showAccount("서버에 연결하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", "error");
    });
    fetch("/account/setup").then(async (response) => {
      if (!response.ok) {
        showSignupMode(false);
        return;
      }
      const body = await response.json();
      showSignupMode(body.companyRegistered === true);
    }).catch(() => {
      showSignupMode(false);
    });
  </script>
</body>
</html>
`;
