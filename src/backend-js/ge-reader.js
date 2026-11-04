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
  }
  return out;
}

module.exports = { parseOffer };
