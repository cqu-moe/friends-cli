import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function setupOfferingEgo(t, options = {}) {
  const baseUrl = options.baseUrl ?? "https://friends.cqu.edu.cn/gateway";
  const root = await mkdtemp(join(tmpdir(), "friends-offering-ego-"));
  const humanName = options.humanName ?? "";
  const html = `<!doctype html><meta charset="utf-8"><div class="cmine">
  <main>
    <label name="活动名称"><input value="${humanName}"></label>
    <div class="field-select"><label name="activityType"><input readonly placeholder="请选择"></label></div>
    <div class="field-select"><label name="activityLevel"><input readonly placeholder="请选择"></label></div>
    <div class="field-select"><label name="organizationName"><input readonly placeholder="请选择"></label></div>
    <div class="field-datetime-picker"><label name="活动开始时间"><input readonly placeholder="请选择"></label></div>
    <div class="field-datetime-picker"><label name="活动结束时间"><input readonly placeholder="请选择"></label></div>
    <label name="活动地点"><input></label><label name="活动联系人"><input></label>
    <label name="联系电话"><input></label><label name="预计志愿者人数"><input></label>
    <label name="预计活动总时长"><input></label><label name="志愿服务内容与时长明细"><textarea></textarea></label>
    <label name="活动概述"><textarea></textarea></label>
    <label name="publicityPicturesGroupUuid"><div class="van-uploader"></div></label>
    <label name="attachmentGroupUuid"><div class="van-uploader"></div></label>
    <button type="button">下一步</button>
  </main><script>
   const label=Object.fromEntries(Array.from(document.querySelectorAll('[name]')).map(node=>[node.getAttribute('name'),node.querySelector('input,textarea')]));
   function picker(items,apply){const panel=document.createElement('div');panel.className='van-picker';const chosen=[];
    for(const item of items){const option=document.createElement('span');option.textContent=item;option.onclick=()=>chosen[0]=item;panel.append(option);}
    const done=document.createElement('button');done.type='button';done.textContent='完成';done.onclick=()=>{apply(chosen[0]);panel.remove()};panel.append(done);document.body.append(panel);}
   document.querySelectorAll('.field-select').forEach((wrapper,index)=>wrapper.onclick=()=>{
     const names=[['activityType',['校内服务','校级','虚构青协']],['activityLevel',['其他','校级','其他']],['organizationName',['其他','其他','虚构青协']]];
     const [field,items]=names[index];picker(items,value=>label[field].value=value);});
   document.querySelectorAll('.field-datetime-picker').forEach((wrapper,index)=>wrapper.onclick=()=>{
     picker(['2026年','11月','2日','9时','12时','0分'],value=>{const values={0:'2026年',1:'11月',2:'2日',3:'9时',4:'12时',5:'0分'};});
     const panel=document.querySelector('.van-picker');let chosen=[];panel.querySelectorAll('span').forEach((span,i)=>span.onclick=()=>chosen[i]=span.textContent);
     panel.querySelector('button').onclick=()=>{const year=chosen[0]??'2026年',month=chosen[1]??'11月',day=chosen[2]??'2日',hour=chosen[4]??'9时',minute=chosen[5]??'0分';
      label[index===0?'活动开始时间':'活动结束时间'].value=year+month+day+' '+(parseInt(hour,10))+':'+String(parseInt(minute,10)).padStart(2,'0');panel.remove();};});
  </script></div>`;
  const htmlPath = join(root, "offering.html");
  const configPath = join(root, "config.json");
  const resultPath = join(root, "result.json");
  await writeFile(htmlPath, html, "utf8");
  await writeFile(configPath, JSON.stringify({
    html: htmlPath, result: resultPath, token: "ego-fixture-token",
    url: `${baseUrl.replace(/\/$/, "").replace("/gateway", "")}/mobile/volunteerManage/campusManagerApply?activityPageTypes=Apply&activityCategory=SCHOOL_ACTIVITY`,
  }), "utf8");
  const command = join(root, "ego-browser");
  await writeFile(command, `#!/bin/sh\nFRIENDS_EGO_FIXTURE_CONFIG=${JSON.stringify(configPath)} exec node ${JSON.stringify(join(process.cwd(), "tests/fixtures/strict-ego.mjs"))}\n`, { mode: 0o700 });
  await chmod(command, 0o700);
  async function observed() { return JSON.parse(await (await import("node:fs/promises")).readFile(resultPath, "utf8")); }
  t.after(async () => await (await import("node:fs/promises")).rm(root, { recursive: true, force: true }));
  return { root, configPath, resultPath, command, observed };
}
