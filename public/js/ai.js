/* =========================================================
   숫자야구 AI 엔진 (레벨별 추론 강도 + 자릿수)
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rules.js'));
  } else {
    root.BaseballAI = factory(root.BaseballRules);
  }
})(typeof self !== 'undefined' ? self : this, function (Rules) {

  // 난이도별 자릿수: 초보/보통은 3자리, 중수/잘함은 4자리, 고수는 5자리
  const LEN_BY_LEVEL = { 1: 3, 2: 3, 3: 4, 4: 4, 5: 5 };

  const MAX_EVAL_CANDIDATES = 220;  // 미니맥스 채점에 쓸 후보 표본 최대 개수
  const MAX_GUESS_POOL = 160;       // 미니맥스로 시도해볼 추측 후보 최대 개수

  const candidateCache = new Map(); // len -> 전체 후보 배열
  function getAllCandidates(len) {
    if (!candidateCache.has(len)) candidateCache.set(len, Rules.allCandidates(len));
    return candidateCache.get(len);
  }

  function randomPick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // 리스트에서 최대 n개를 무작위로 뽑는다 (n보다 작으면 그대로 반환)
  function sample(list, n) {
    if (list.length <= n) return list;
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  // 후보들 중, 각 후보를 "정답"이라 가정했을 때 이 추측(guess)이 만들어내는
  // (strikes,balls) 결과별 그룹 크기의 최댓값(최악의 경우 남는 후보 수)을 계산
  function worstCaseRemaining(guess, candidates) {
    const buckets = new Map();
    for (const cand of candidates) {
      const g = Rules.grade(cand, guess);
      const key = g.strikes + '-' + g.balls;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    let max = 0;
    for (const v of buckets.values()) if (v > max) max = v;
    return max;
  }

  // Knuth 스타일 미니맥스: 후보군을 가장 확실하게 줄여줄 추측을 고른다
  // (후보/추측 풀이 너무 크면 표본을 뽑아 계산량을 안전한 수준으로 제한한다)
  function bestMinimaxGuess(candidates, poolForGuessing, len) {
    if (candidates.length <= 1) return candidates[0] || randomPick(getAllCandidates(len));

    const evalCandidates = sample(candidates, MAX_EVAL_CANDIDATES);
    const rawPool = poolForGuessing.length <= MAX_GUESS_POOL ? poolForGuessing : candidates;
    const guessPool = sample(rawPool, MAX_GUESS_POOL);

    let best = null, bestScore = Infinity;
    for (const guess of guessPool) {
      const score = worstCaseRemaining(guess, evalCandidates);
      const isCandidate = candidates.includes(guess);
      if (score < bestScore || (score === bestScore && isCandidate && best && !best.isCandidate)) {
        bestScore = score;
        best = { guess, isCandidate };
      }
    }
    return best ? best.guess : randomPick(candidates);
  }

  /**
   * level: 1(초보) ~ 5(고수)
   * history: [{guess, strikes, balls, out}] — 이 AI가 지금까지 낸 추측과 그 결과
   * len: 자릿수를 직접 지정하고 싶을 때 (생략하면 레벨에 맞는 기본 자릿수 사용)
   */
  function pickGuess(history, level, len) {
    len = len || LEN_BY_LEVEL[level] || Rules.LEN;
    const all = getAllCandidates(len);
    const tried = new Set((history || []).map((h) => h.guess));

    switch (level) {
      case 1: {
        // 완전 무작위 (과거 힌트 무시, 이미 낸 추측만 피함)
        let g;
        do { g = randomPick(all); } while (tried.has(g));
        return g;
      }
      case 2: {
        // 아웃(0스트라이크 0볼)으로 확인된 숫자는 최소한 피해서 조금 더 똑똑하게
        const outDigits = new Set();
        (history || []).forEach((h) => {
          if (h.out) h.guess.split('').forEach((d) => outDigits.add(d));
        });
        const pool = all.filter((g) => !tried.has(g) && ![...g].some((d) => outDigits.has(d)));
        return pool.length ? randomPick(pool) : randomPick(all.filter((g) => !tried.has(g)));
      }
      case 3: {
        // 지금까지의 모든 힌트와 모순 없는 후보 중 무작위
        const cands = Rules.filterCandidates(all, history).filter((g) => !tried.has(g));
        const pool = cands.length ? cands : all.filter((g) => !tried.has(g));
        return randomPick(pool);
      }
      case 4: {
        // 후보 압축 + 남은 후보를 잘 줄여줄 추측을 후보 안에서 고름
        const cands = Rules.filterCandidates(all, history).filter((g) => !tried.has(g));
        if (!cands.length) return randomPick(all.filter((g) => !tried.has(g)));
        if (cands.length <= 2) return cands[0];
        return bestMinimaxGuess(cands, cands, len);
      }
      case 5:
      default: {
        // 진짜 미니맥스: 후보 밖의 "정보 탐색용" 추측까지 고려
        const cands = Rules.filterCandidates(all, history).filter((g) => !tried.has(g));
        if (!cands.length) return randomPick(all.filter((g) => !tried.has(g)));
        if (cands.length <= 2) return cands[0];
        const guessPool = all.filter((g) => !tried.has(g));
        return bestMinimaxGuess(cands, guessPool, len);
      }
    }
  }

  return { pickGuess, worstCaseRemaining, bestMinimaxGuess, getAllCandidates, LEN_BY_LEVEL };
});
