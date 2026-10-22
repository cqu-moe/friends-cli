import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const config = JSON.parse(process.env.LEADER_EGO_CONFIG);
const evidence = { clicks: [], fills: [], externalWrites: 0, submits: 0, inputEvents: 0, changeEvents: 0, handoffs: 0, navigations: 0 };
const origin = new URL(config.baseUrl).origin;
const route = "/mobile/groupManage/studentLeaderApply?uuid=leader-org";
const dom = new JSDOM('<!doctype html><iframe></iframe>', { url: origin + "/mobile/", runScripts: "dangerously" });
const w = dom.window;
for (const [key, value] of Object.entries({ token_str: "ego-token", userLevel_str: "XS", userInfo_obj: "{}", account_str: "fixture", loginModel_str: "STUDENT" })) w.localStorage.setItem(key, value);
const iframe = w.document.querySelector("iframe"); iframe.src = origin + (config.mode === "wrong-route" ? route.replace("leader-org", "other-org") : route);
const f = iframe.contentWindow, d = f.document;
d.open(); d.write(`<!doctype html><style>.search,.posts{display:none}.open{display:block}</style><h1>申请信息</h1>
<div class="field-block"><span>新负责人</span><div class="van-field candidate"><label class="van-field__label">负责人</label><div class="van-field__body">${config.mode === "human" ? "人工选择" : config.mode === "same-name" ? "新负责人" : ""}</div></div>
<div class="van-field"><label class="van-field__label">政治面貌</label><div class="van-field__body political"></div></div><label>负责人电话<input name="newResponsiblePhone" value="${config.mode === "human" ? "13700000003" : ""}"></label>
<div class="van-field post"><label class="van-field__label">负责人职务</label><div class="van-field__body"></div></div></div><textarea placeholder="请输入变更原因">${config.mode === "human" ? "人工原因" : ""}</textarea>
<section class="search"><input placeholder="学号/姓名"><button class="search-run">搜索</button><div class="results"></div><button class="choose">确定</button></section>
<section class="posts"><h2>选择职务</h2><div role="option">新职务</div><button class="post-confirm">确认</button></section><button class="submit">提交申请</button>`); d.close();
function visible(e) { for (let p=e; p; p=p.parentElement) if (f.getComputedStyle(p).display === "none") return false; return true; }
Object.defineProperty(f.HTMLElement.prototype, "innerText", { get() { return this.textContent; } });
f.Element.prototype.getBoundingClientRect = function() { return visible(this) ? { width: 320, height: 48 } : { width: 0, height: 0 }; };
f.Element.prototype.setAttribute = function() { throw new Error("DOM attribute mutation is forbidden"); };
f.fetch = w.fetch = async() => { evidence.externalWrites++; throw new Error("Unexpected browser API call"); };
f.XMLHttpRequest.prototype.send = function() { evidence.externalWrites++; throw new Error("Unexpected XHR"); };
f.HTMLFormElement.prototype.submit = function() { evidence.submits++; };
d.querySelector(".submit").addEventListener("click", () => { evidence.submits++; evidence.externalWrites++; });
d.querySelector(".candidate").addEventListener("click", () => d.querySelector(".search").classList.add("open"));
d.querySelector(".search-run").addEventListener("click", () => {
  if (d.querySelector('[placeholder="学号/姓名"]').value !== "20210002") throw new Error("Search must bind the exact student number");
  d.querySelector(".results").innerHTML = '<div class="stu-info"><div role="radio" aria-checked="false"></div><div class="right">新负责人/新职务/电话：13800000002</div></div>';
  d.querySelector('[role="radio"]').addEventListener("click", e => { e.currentTarget.ariaChecked = "true"; });
});
d.querySelector(".choose").addEventListener("click", () => {
  if (d.querySelector('[role="radio"]').ariaChecked !== "true") throw new Error("Candidate was not visibly selected");
  d.querySelector(".candidate .van-field__body").textContent = "新负责人";
  d.querySelector('[name="newResponsiblePhone"]').value = "13800000002";
  d.querySelector(".political").textContent = "共青团员";
  d.querySelector(".search").classList.remove("open");
});
d.querySelector(".post").addEventListener("click", () => d.querySelector(".posts").classList.add("open"));
let postSelected=false;
d.querySelector('[role="option"]').addEventListener("click", () => postSelected=true);
d.querySelector(".post-confirm").addEventListener("click", () => { if (!postSelected) throw new Error("Post was not selected"); d.querySelector(".post .van-field__body").textContent="新职务"; d.querySelector(".posts").classList.remove("open"); });
for (const field of d.querySelectorAll("input,textarea")) { field.addEventListener("input", () => evidence.inputEvents++); field.addEventListener("change", () => evidence.changeEvents++); }
let refs = new Map(), next = 47;
function active() { if (evidence.handoffs) throw new Error("Operation after handoff"); }
async function evaluate(callback,arg) { active(); w.__arg=structuredClone(arg); const result=await w.eval(`(${callback.toString()})(__arg)`); return result === undefined ? undefined : JSON.parse(JSON.stringify(result)); }
function one(selector) {
  const [css, ordinal] = selector.replace(/^loc=css:/, "").split(" >> nth=");
  let matches = selector.startsWith("@") ? [refs.get(selector)].filter(Boolean) : [...d.querySelectorAll(css)].filter(visible);
  if (ordinal !== undefined) matches = [matches[Number(ordinal)]].filter(Boolean);
  if (matches.length !== 1) throw new Error("Expected one live control: " + selector); return matches[0];
}
const page = {
  async url() { active(); return w.location.href; },
  async goto() { evidence.navigations++; throw new Error("Never discard the current form"); },
  evaluate,
  async snapshot() {
    active(); refs=new Map(); const lines=[`iframe [ref=${next++}]`];
    for (const e of d.querySelectorAll("input,textarea,button,[role=radio],[role=option]")) {
      if (!visible(e)) continue;
      const ref=next++; refs.set("@"+ref,e);
      const role=e.getAttribute("role") ?? (e.tagName === "BUTTON" ? "button" : "textbox");
      const label=e.placeholder || e.name || e.textContent;
      lines.push(`  ${role} [ref=${ref}]`, `    ${label}`);
    } return lines.join("\n");
  },
  async click(selector) { active(); evidence.clicks.push(selector); one(selector).click(); },
  async fill(selector,value) { active(); const e=one(selector); if (e.readOnly || e.disabled) throw new Error("Cannot fill readonly field"); evidence.fills.push(selector); e.value=value; e.dispatchEvent(new f.Event("input",{bubbles:true})); e.dispatchEvent(new f.Event("change",{bubbles:true})); },
  async waitForFunction(fn,arg) { if (!await evaluate(fn,arg)) throw new Error("Expected observable form state"); },
};
const strictPage=new Proxy(page,{get(target,key){if(!(key in target))throw new Error("Undocumented Page method "+String(key)); return target[key];}});
const originalLog = console.log;
if (config.mode === "lost-result") console.log = (...args) => {
  if (String(args[0]).startsWith("FRIENDS_LEADER_PREPARED:")) originalLog("FRIENDS_LEADER_PREPARED:{invalid");
  else originalLog(...args);
};
try { const source=await readFile(config.script,"utf8"); await new Function("taskSpace","return (async()=>{"+source+"})()")(async()=>({page(){return strictPage;},async handOff(){evidence.handoffs++;}})); }
finally { console.log = originalLog; await writeFile(config.evidence,JSON.stringify({...evidence,candidate:d.querySelector(".candidate .van-field__body").textContent,phone:d.querySelector('[name="newResponsiblePhone"]').value,post:d.querySelector(".post .van-field__body").textContent,reason:d.querySelector('textarea').value})); w.close(); }
