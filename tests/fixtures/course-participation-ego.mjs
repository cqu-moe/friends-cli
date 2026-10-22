#!/usr/bin/env node
import { JSDOM } from 'jsdom';
import { readFile, writeFile } from 'node:fs/promises';
let script = ''; for await (const chunk of process.stdin) script += chunk;
const config = JSON.parse(await readFile(process.env.FRIENDS_COURSE_EGO_CONFIG, 'utf8'));
if (process.env.EGO_SCRIPT_LOG) await writeFile(process.env.EGO_SCRIPT_LOG, script, { flag: 'a' });
const stats = { clicks: [], fills: [], uploads: [], finalWrites: 0, handoffs: 0, navigations: 0, callbacks: [], snapshots: 0 };
const dom = new JSDOM(`<iframe src="${config.url}"></iframe>`, { url: 'https://friends.cqu.edu.cn/mobile/index', runScripts: 'dangerously' });
const outer = dom.window, frame = outer.document.querySelector('iframe').contentWindow;
const d = frame.document;
d.open(); d.write(config.html); d.close();
for (const w of [outer, frame]) {
  w.localStorage.setItem('token_str', config.token ?? 'ego-fixture-token');
  w.localStorage.setItem('userLevel_str', 'XS');
  w.localStorage.setItem('userInfo_obj', JSON.stringify({ account: config.account ?? 'fixture-account', userLoginStateLevel: 'XS', departmentNo: 'unit-a' }));
  w.localStorage.setItem('account_str', config.account ?? 'fixture-account');
  w.localStorage.setItem('loginModel_str', 'STUDENT');
}
let handedOff = false;
const active = () => { if (handedOff) throw new Error('Action after handoff'); };
const visible = e => { for (let n = e; n; n = n.parentElement) if (frame.getComputedStyle(n).display === 'none' || n.hidden) return false; return true; };
function all(selector) {
  let css = selector.replace(/^loc=css:/, '');
  const nth = css.match(/ >> nth=(\d+)$/); if (nth) css = css.slice(0, nth.index);
  const nodes = [...d.querySelectorAll(css)].filter(visible);
  return nth ? nodes.slice(Number(nth[1]), Number(nth[1]) + 1) : nodes;
}
function one(selector) { const nodes = all(selector); if (nodes.length !== 1) throw new Error('Ambiguous selector: ' + selector); return nodes[0]; }
const model = {};
const buffers = new WeakMap(), pendingUploads = [];
d.querySelectorAll('input:not([type=file]),textarea').forEach((e, i) => {
  model[i] = e.value;
  e.addEventListener('input', () => { model[i] = e.value; stats.callbacks.push('input:' + e.value); });
});
d.querySelectorAll('[role=radio],[role=checkbox]').forEach(e => e.addEventListener('click', () => {
  if (e.getAttribute('role') === 'radio') e.closest('.options').querySelectorAll('[role=radio]').forEach(r => r.setAttribute('aria-checked', 'false'));
  e.setAttribute('aria-checked', String(e.getAttribute('aria-checked') !== 'true'));
  stats.callbacks.push('choice:' + e.closest('.van-cell').querySelector('.van-cell__title').textContent);
}));
d.querySelectorAll('.list-action > div').forEach(e => e.addEventListener('click', () => {
  const dialog = d.createElement('div'); dialog.className = 'van-dialog';
  dialog.innerHTML = `<div class="van-dialog__header">${e.textContent === '撤销' ? '撤销确认' : '退出确认'}</div><button class="van-dialog__confirm">确认</button>`;
  dialog.querySelector('button').addEventListener('click', () => { stats.finalWrites++; }); d.body.append(dialog);
  stats.callbacks.push('open-dialog');
}));
d.querySelectorAll('.footer button').forEach(e => e.addEventListener('click', () => { stats.finalWrites++; }));
d.querySelectorAll('input[type=file]').forEach(e => e.addEventListener('change', () => {
  for (const file of e.files) {
    const preview = d.createElement('div'); preview.className = 'van-uploader__preview'; preview.textContent = file.name;
    const mask = d.createElement('div'); mask.className = 'van-uploader__mask'; mask.textContent = '上传中'; preview.append(mask);
    e.closest('.form-uploader').prepend(preview); stats.callbacks.push('upload:' + file.name);
    pendingUploads.push((async () => {
      try {
        if (!config.gateway) throw new Error('Strict fixture requires a controlled upload server');
        const form = new FormData();
        form.append('files', new Blob([buffers.get(file)], { type: file.type }), file.name);
        form.append('groupId', e.dataset.groupId ??= crypto.randomUUID().replaceAll('-', ''));
        const response = await fetch(config.gateway + '/ek-agg-mob/biz-common/protected-file-upload', {
          method: 'POST', body: form, headers: { 'h-zove-appkey': 'zovecenter-saip-ek-agg-mob', 'h-zove-token': config.token ?? 'ego-fixture-token' },
        });
        const receipt = await response.json();
        if (receipt.code !== '0' || !receipt.data?.[0] || config.uploadLostAt === stats.uploads.length) throw new Error('Upload receipt lost');
        mask.remove();
      } catch { mask.textContent = '上传失败'; }
    })());
  }
}));
const page = {
  async url() { active(); return outer.location.href; },
  async goto() { stats.navigations++; throw new Error('Navigation would discard human inputs'); },
  async snapshot() {
    active(); stats.snapshots++;
    if (config.changeOnSnapshot && stats.snapshots === 2) d.querySelector('textarea').value = 'human-late-edit';
    return [...d.querySelectorAll('button,input,textarea,.list-action > div')].map((e, i) => `button [ref=${i + 1}]\n  ${e.textContent || e.getAttribute('name') || 'input'}`).join('\n');
  },
  async evaluate(fn, arg) { active(); outer.__arg = structuredClone(arg); const result = await outer.eval(`(${fn.toString()})(__arg)`); return result === undefined ? undefined : JSON.parse(JSON.stringify(result)); },
  async waitForFunction(fn, arg) {
    active(); outer.__arg = structuredClone(arg);
    for (let i = 0; i < 30; i++) { if (await outer.eval(`(${fn.toString()})(__arg)`)) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('Page state did not settle');
  },
  async waitForSelector(selector, { state = 'visible' } = {}) { active(); if (state === 'hidden' ? all(selector).length > 0 : all(selector).length === 0) throw new Error('Missing selector: ' + selector); },
  async click(selector) { active(); const e = one(selector); stats.clicks.push(selector); e.click(); },
  async fill(selector, value) { active(); const e = one(selector); if (e.disabled || e.readOnly) throw new Error('Cannot fill readonly input'); stats.fills.push(selector); e.value = value; e.dispatchEvent(new frame.Event('input', { bubbles: true })); e.dispatchEvent(new frame.Event('change', { bubbles: true })); },
  async setInputFiles(selector, paths) {
    active(); const e = one(selector); if (e.type !== 'file' || e.disabled) throw new Error('Expected editable file control');
    const files = await Promise.all(paths.map(async path => {
      const bytes = await readFile(path);
      const file = new frame.File([bytes], path.split('/').at(-1), { type: path.endsWith('.pdf') ? 'application/pdf' : 'image/png' });
      buffers.set(file, bytes); return file;
    }));
    Object.defineProperty(e, 'files', { configurable: true, value: files }); stats.uploads.push(...files.map(f => f.name)); e.dispatchEvent(new frame.Event('change', { bubbles: true }));
    await Promise.all(pendingUploads);
    if (config.loseBridgeAfterUpload) throw new Error('Upload bridge response lost');
  },
};
const task = { page(label) { if (label !== (config.page ?? 'p2')) throw new Error('Wrong page'); return page; }, async handOff() { active(); stats.handoffs++; handedOff = true; } };
try { await new Function('taskSpace', `return (async()=>{${script}})()`)(async id => { if (id !== 8) throw new Error('Wrong task'); return task; }); }
finally { await writeFile(config.result, JSON.stringify({ ...stats, model, values: [...d.querySelectorAll('input:not([type=file]),textarea')].map(e => e.value), html: d.body.innerHTML })); dom.window.close(); }
