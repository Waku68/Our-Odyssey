// 画面の部品を作る小さな道具。

// h('div', { class: 'x', onclick: f }, 子...) で要素を作る
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  const a = attrs || {};
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = true;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  return el;
}

const svgIcon = (el, svg) => { el.innerHTML = svg; return el; };

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export { h, svgIcon, reduceMotion };
