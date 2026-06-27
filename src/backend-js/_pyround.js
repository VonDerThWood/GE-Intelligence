/**
 * Exact replication of Python's round() and sum() for floats — shared by
 * every ported module that has a `round(...)` or `sum(...)` call in the
 * original. Extracted here once both dxp_intelligence.js and run.js
 * needed the identical logic (see SESSION_LOG.md, 2026-06-26, for the two
 * real bugs that made this necessary — not a hypothetical precaution).
 */

// Python's round() uses round-half-to-even and operates on the EXACT
// binary value of the double (not a decimal approximation). A naive
// epsilon-based tie check gets this wrong in both directions (misses real
// ties on values that look "clean," and flags near-ties that aren't
// actually exact) — so this decomposes the double's actual IEEE754
// mantissa/exponent via BigInt and does the rounding as exact rational
// arithmetic instead, with no floating-point approximation anywhere.
function _doubleToExactFraction(x) {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0), lo = buf.getUint32(4);
  let exponent = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp2;
  if (exponent === 0) {
    exp2 = -1074n; // subnormal
  } else {
    mantissa |= (1n << 52n); // implicit leading bit
    exp2 = BigInt(exponent) - 1075n;
  }
  if (exp2 >= 0n) return [mantissa << exp2, 1n];
  return [mantissa, 1n << -exp2];
}

function pyRound(x, ndigits = 0) {
  if (!isFinite(x) || x === 0) return x;
  const sign = x < 0 ? -1 : 1;
  const [num, den] = _doubleToExactFraction(Math.abs(x));
  const factor = 10n ** BigInt(ndigits);
  const scaledNum = num * factor;
  const q = scaledNum / den; // BigInt division truncates; num,den >= 0 so this is floor
  const r = scaledNum % den;
  const twiceR = 2n * r;
  let resultInt;
  if (twiceR < den) resultInt = q;
  else if (twiceR > den) resultInt = q + 1n;
  else resultInt = (q % 2n === 0n) ? q : q + 1n; // exact tie -> round to even
  return sign * (Number(resultInt) / Number(factor));
}

// CPython 3.12+'s sum() builtin uses Neumaier (improved Kahan) compensated
// summation for floats, NOT naive left-to-right addition — confirmed
// empirically: a plain reduce() and Python's sum() can produce genuinely
// different doubles for the same float list. Anywhere the Python original
// calls sum() on a list of floats, this must be used instead of a naive
// reduce, or the two will silently drift apart over enough additions.
function pySum(arr) {
  let total = 0, comp = 0;
  for (const x of arr) {
    const t = total + x;
    if (Math.abs(total) >= Math.abs(x)) comp += (total - t) + x;
    else comp += (x - t) + total;
    total = t;
  }
  return total + comp;
}

module.exports = { pyRound, pySum };
