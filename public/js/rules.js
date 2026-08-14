/* =========================================================
   숫자야구 규칙 엔진 (브라우저 & Node 양쪽에서 사용)
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BaseballRules = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const LEN = 3; // 자릿수 (표준 숫자야구: 서로 다른 숫자 3개)

  function randomSecret(len) {
    len = len || LEN;
    const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = digits.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [digits[i], digits[j]] = [digits[j], digits[i]];
    }
    return digits.slice(0, len).join('');
  }

  // 자릿수가 len개이고, 숫자가 서로 겹치지 않는 유효한 추측/비밀번호인지 확인
  function isValidNumber(str, len) {
    len = len || LEN;
    if (typeof str !== 'string') return false;
    if (!new RegExp('^\\d{' + len + '}$').test(str)) return false;
    return new Set(str.split('')).size === len;
  }

  // secret 대비 guess의 채점: 스트라이크(자리+숫자 일치), 볼(숫자만 일치)
  function grade(secret, guess) {
    let strikes = 0, balls = 0;
    for (let i = 0; i < secret.length; i++) {
      if (guess[i] === secret[i]) strikes++;
      else if (secret.includes(guess[i])) balls++;
    }
    return { strikes, balls, out: strikes === 0 && balls === 0 };
  }

  function isHomerun(strikes, len) {
    return strikes === (len || LEN);
  }

  // 가능한 모든 후보 (len자리, 숫자 겹치지 않음) — len=3이면 720개, len=4면 5040개
  function allCandidates(len) {
    len = len || LEN;
    const results = [];
    const digits = '0123456789';
    function build(prefix, used) {
      if (prefix.length === len) { results.push(prefix); return; }
      for (const d of digits) {
        if (used.has(d)) continue;
        used.add(d);
        build(prefix + d, used);
        used.delete(d);
      }
    }
    build('', new Set());
    return results;
  }

  // history: [{guess, strikes, balls}] 와 모순되지 않는 후보만 남긴다
  function filterCandidates(candidates, history) {
    if (!history || !history.length) return candidates;
    return candidates.filter((cand) => {
      return history.every((h) => {
        const g = grade(cand, h.guess);
        return g.strikes === h.strikes && g.balls === h.balls;
      });
    });
  }

  return {
    LEN, randomSecret, isValidNumber, grade, isHomerun,
    allCandidates, filterCandidates,
  };
});
