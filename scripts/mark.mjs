#!/usr/bin/env node
// Prints a browser function that frames defects on the page before a
// screenshot: a red box around each target, a numbered badge and a short
// label. The numbers match the legend under the figure in the PDF report.
//
//   pw eval "$(node "$QA_HOME/scripts/mark.mjs" --box 'img.hero' 'Image cassée' --text 'Nous contacter' 'Lien vers une page 404')"
//   pw screenshot --filename=screens/report/QA-009.png
//   pw eval "$(node "$QA_HOME/scripts/mark.mjs" --clear)"
//
// Targets: --box <css selector> <label> · --text <exact visible text> <label>
// · --rect <x,y,w,h in CSS px of the viewport> <label>. The page scrolls to
// the first target; --text frames the text itself, not its whole block. The
// function returns one line: "1 ok · 2 NOT FOUND · 3 ok".

function draw(specs) {
  document.querySelectorAll('[data-qa-mark]').forEach(e => e.remove());
  if (!specs.length) return 'cleared';
  const byText = text => {
    let best = null;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[data-qa-mark]') || (el.innerText || '').trim() !== text) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (!best || r.width * r.height <= best.r.width * best.r.height)) best = { el, r };
    }
    return best && best.el;
  };
  const els = specs.map(s => (s.css ? document.querySelector(s.css) : s.text ? byText(s.text) : null));
  const first = els.find(Boolean);
  if (first) first.scrollIntoView({ block: 'center', inline: 'nearest' });
  const layer = document.createElement('div');
  layer.setAttribute('data-qa-mark', '');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  document.documentElement.appendChild(layer);
  const placed = [];
  return specs.map((s, i) => {
    const n = i + 1;
    let r = els[i] ? els[i].getBoundingClientRect() : null;
    if (s.text && els[i]) { const range = document.createRange(); range.selectNodeContents(els[i]); r = range.getBoundingClientRect(); }
    if (s.rect) r = { left: s.rect[0], top: s.rect[1], width: s.rect[2], height: s.rect[3] };
    if (!r || (!r.width && !r.height)) return { n, found: false };
    const x = r.left + scrollX, y = r.top + scrollY, pad = 4;
    // a target against the page edge keeps its left and top sides on screen
    const bx = Math.max(scrollX + 2, x - pad), by = Math.max(scrollY + 2, y - pad);
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:${x + r.width + pad - bx}px;height:${y + r.height + pad - by}px;` +
      'border:3px solid #e5283a;border-radius:6px;box-shadow:0 0 0 2px #fff;box-sizing:border-box';
    const tag = document.createElement('div');
    const above = y - pad - 30 > scrollY;
    tag.style.cssText = `position:absolute;left:${Math.max(scrollX + 2, x - pad)}px;top:${above ? y - pad - 30 : y + r.height + pad + 4}px;` +
      'display:flex;align-items:center;gap:6px;max-width:360px;padding:3px 8px 3px 3px;border-radius:14px;background:#e5283a;color:#fff;' +
      'font:600 13px/18px system-ui,-apple-system,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const num = document.createElement('span');
    num.textContent = n;
    num.style.cssText = 'flex:none;width:20px;height:20px;border-radius:50%;background:#fff;color:#e5283a;text-align:center;line-height:20px';
    const text = document.createElement('span');
    text.textContent = s.label;
    text.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
    tag.append(num, text);
    layer.append(box, tag);
    // labels never cover each other: push this one down until it is clear
    const hit = a => placed.some(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
    for (let k = 0; k < 20 && hit(tag.getBoundingClientRect()); k++) tag.style.top = `${parseFloat(tag.style.top) + 26}px`;
    placed.push(tag.getBoundingClientRect());
    return { n, label: s.label, found: true };
  }).map(m => `${m.n} ${m.found ? 'ok' : 'NOT FOUND'}`).join(' · ');
}

const args = process.argv.slice(2);
const specs = [];
if (!args.includes('--clear')) {
  for (let i = 0; i < args.length; i++) {
    const [flag, target, label] = [args[i], args[i + 1], args[i + 2]];
    if (!['--box', '--text', '--rect'].includes(flag) || target === undefined || label === undefined) {
      console.error(`usage: mark.mjs (--box <css> <label> | --text <text> <label> | --rect <x,y,w,h> <label>)... | --clear\nunexpected: ${args.slice(i).join(' ')}`);
      process.exit(2);
    }
    if (flag === '--box') specs.push({ css: target, label });
    if (flag === '--text') specs.push({ text: target, label });
    if (flag === '--rect') {
      const rect = target.split(',').map(Number);
      if (rect.length !== 4 || rect.some(Number.isNaN)) { console.error(`--rect needs x,y,w,h: ${target}`); process.exit(2); }
      specs.push({ rect, label });
    }
    i += 2;
  }
}
process.stdout.write(`() => (${draw.toString()})(${JSON.stringify(specs)})`);
