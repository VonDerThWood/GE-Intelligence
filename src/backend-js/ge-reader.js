/**
 * GE offer reader (Ben, 2026-11-04): turns OCR text from an opened Grand Exchange
 * offer into { side, name, quantity, price, filled, coins }. Dev mode only.
 * Reads the offer's detail screen, because that's what shows the real coins spent.
 * OCR can be wrong, so the app always shows the result for checking before saving.
 */

const toNum = s => Number(String(s).replace(/[^\d]/g, ''));

// The longest catalogue name found on a line, so "Dragon dart tip" beats "Dart".
function findItem(lines, itemNames) {
  const lower = itemNames.map(n => [n, n.toLowerCase()]).sort((a, b) => b[1].length - a[1].length);
  for (const line of lines) {
    const l = line.toLowerCase();
    for (const [name, low] of lower) {
      const at = l.indexOf(low);
      if (at < 0) continue;
      const before = l[at - 1], after = l[at + low.length];
      if ((!before || !/[a-z]/.test(before)) && (!after || !/[a-z]/.test(after))) return name;
    }
  }
  return null;
}

function parseOffer(text, itemNames = []) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const out = { side: null, name: null, quantity: null, price: null, filled: null, coins: null };

  const headIdx = lines.findIndex(l => /\b(buy|sell)\s*offer\b/i.test(l));
  if (headIdx >= 0) {
    out.side = /\bsell\s*offer\b/i.test(lines[headIdx]) ? 'sell' : 'buy';
    // The item name sits on the same line as "Buy Offer", to its right.
    const rest = lines[headIdx].replace(/^.*?\b(?:buy|sell)\s*offer\b/i, '');
    out.name = findItem([rest, ...lines.slice(headIdx + 1, headIdx + 3)], itemNames);
  }

  // The line under "Quantity: / Your price per item:" has both numbers.
  const qIdx = lines.findIndex(l => /quantity/i.test(l));
  if (qIdx >= 0) {
    for (const l of lines.slice(qIdx + 1, qIdx + 3)) {
      const nums = l.match(/\d[\d,]*/g);
      if (nums && nums.length >= 2) {
        out.quantity = toNum(nums[0]);
        out.price = toNum(nums[nums.length - 1]);
        break;
      }
    }
  }

  // "bought 12,397 so far for 71,282,750 coins", "sold 8,173 so far and received
  // 24,429,097 coins". The sold figure is after GE tax.
  const fills = text && String(text).match(/\b(bought|sold)\s+([\d,]+)\s+so\s+far\s+(?:for|and\s+received)\s+([\d,]+)\s+coins/i);
  if (fills) {
    out.filled = toNum(fills[2]);
    out.coins = toNum(fills[3]);
    if (!out.side) out.side = /sold/i.test(fills[1]) ? 'sell' : 'buy';
    // If the quantity line didn't read, the progress bar has it: "8,173 / 16,097".
    if (out.quantity == null) {
      for (const m of String(text).matchAll(/([\d,]{1,})\s*[\/|]\s*([\d,]{3,})/g)) {
        if (toNum(m[1]) === out.filled && toNum(m[2]) >= out.filled) { out.quantity = toNum(m[2]); break; }
      }
    }
  }
  // The offer's total sits on its own line: "48,113,933 coins".
  for (const l of lines) {
    if (/so\s+far/i.test(l)) continue;
    const t = l.match(/(\d[\d,]{3,})\s+coins/i);
    if (t) { out.total = toNum(t[1]); break; }
  }
  // The total settles it when the boxes misread (the 1 / 10 / 100 buttons can pass
  // for numbers): the quantity is a number on screen that divides it into a whole
  // price, and it can't be less than what's filled.
  if (out.total && out.side) {
    const keep = 0.98;
    const fits = q => {
      if (!(q > 0) || q < (out.filled || 0)) return null;
      const each = out.total / q / (out.side === 'sell' ? keep : 1);
      const p = Math.round(each);
      return p >= 1 && Math.abs(each - p) * q <= Math.max(2, q * 0.01) / (out.side === 'sell' ? keep : 1) ? p : null;
    };
    const matches = (q, p) => q && p && Math.abs(q * p * (out.side === 'sell' ? keep : 1) - out.total) <= Math.max(2, q * 0.01);
    if (!matches(out.quantity, out.price)) {
      const numbers = [...new Set((String(text).match(/\d[\d,]*/g) || []).map(toNum))]
        .filter(n => n > 0 && n !== out.total && n !== out.coins).sort((a, b) => b - a);
      const seen = new Set(numbers);
      // Best: both numbers are on screen. Next: the quantity is, and the price follows.
      const pick = numbers.find(q => seen.has(fits(q))) || numbers.find(q => fits(q) != null);
      if (pick) { out.quantity = pick; out.price = fits(pick); }
      // Neither on screen: offers usually fill at their price, so coins / filled
      // gives the price, and the total then has to give a whole quantity.
      else if (out.filled > 0 && out.coins > 0) {
        const rate = out.side === 'sell' ? keep : 1;
        const p = Math.round(out.coins / out.filled / rate);
        const q = p > 0 ? Math.round(out.total / (p * rate)) : 0;
        if (q >= out.filled && matches(q, p)) { out.quantity = q; out.price = p; }
      }
    }
  }
  // A quantity below what's already filled can't be right, so leave it blank.
  if (out.quantity != null && out.filled != null && out.quantity < out.filled) { out.quantity = null; out.price = null; }
  return out;
}

// Do the numbers agree with each other? The GE's total is quantity x price, less
// 2% tax on sells, and fills can't beat what the offer allows by much.
function offerAddsUp(o) {
  if (!o.side || !o.name || !o.quantity || !o.price || !o.total || o.filled == null || o.coins == null) return false;
  const gross = o.quantity * o.price;
  const expected = o.side === 'sell' ? gross * 0.98 : gross;
  if (Math.abs(o.total - expected) > Math.max(2, o.quantity * 0.01)) return false;
  if (o.filled > o.quantity) return false;
  if (o.filled === 0) return o.coins === 0;
  const each = o.coins / o.filled;
  return o.side === 'buy' ? each <= o.price + 0.01 : each >= o.price * 0.98 - 0.01;
}

const sameOffer = (a, b) => ['side', 'name', 'quantity', 'price', 'filled', 'coins'].every(k => a[k] === b[k]);

// Reads at several sizes. Confirmed means two reads agree and the numbers add up.
// Otherwise it returns the most complete read, for the person to check closely.
async function readOfferPasses(readPass, passes) {
  const seen = [];
  for (const p of passes) {
    const offer = await readPass(p);
    if (offerAddsUp(offer) && seen.some(s => offerAddsUp(s) && sameOffer(s, offer))) return { ...offer, confirmed: true };
    seen.push(offer);
  }
  const score = o => (offerAddsUp(o) ? 100 : 0) + ['side', 'name', 'quantity', 'price', 'filled', 'coins', 'total'].filter(k => o[k] != null).length;
  return { ...seen.sort((a, b) => score(b) - score(a))[0], confirmed: false };
}

module.exports = { parseOffer, offerAddsUp, readOfferPasses };
