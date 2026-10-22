import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function setupOfferingEgo(t, options = {}) {
  const baseUrl = options.baseUrl ?? "https://friends.cqu.edu.cn/gateway";
  const root = await mkdtemp(join(tmpdir(), "friends-offering-ego-"));
  const humanName = options.humanName ?? "";
  const html = `<!doctype html><meta charset="utf-8"><div class="cmine"><main>
    <textarea name="活动名称">${humanName}</textarea>
    ${['活动类型','活动级别','组织单位'].map(name=>'<div class="field-select"><div class="field-select"><input name="'+name+'" style="pointer-events:none" readonly></div></div>').join('')}
    ${['活动开始时间','活动结束时间'].map(name=>'<div class="field-datetime-picker"><input name="'+name+'" readonly></div>').join('')}
    <input name="活动地点"><input name="活动联系人" value="人工联系人">
    <input name="联系电话" value="13900000000"><input name="预计志愿者人数">
    <input name="totalDuration"><textarea name="activityContent"></textarea><textarea name="overview"></textarea>
    <div class="van-uploader"><input type="file"></div><div class="van-uploader"><input type="file"></div>
    <button id="final" type="button">下一步</button>
  </main><script>
   const controls=Object.fromEntries(Array.from(document.querySelectorAll('[name]')).map(node=>[node.name,node]));
   function picker(columns,apply){const panel=document.createElement('div');panel.className='van-picker';const chosen=columns.map(items=>items[0]);const popup=document.createElement('div');popup.className='van-popup';popup.append(panel);
    const toolbar=document.createElement('div');toolbar.className='van-picker__toolbar';
    const done=document.createElement('button');done.type='button';done.className='van-picker__confirm';done.textContent='确认';done.onclick=()=>{apply(chosen);popup.remove()};toolbar.append(done);panel.append(toolbar);
    const all=document.createElement('div');all.className='van-picker__columns';panel.append(all);
    columns.forEach((items,index)=>{const column=document.createElement('div');column.className='van-picker-column';all.append(column);
     const list=document.createElement('ul');column.append(list);for(const item of items){const option=document.createElement('li');option.className='van-picker-column__item'+(item===items[0]?' van-picker-column__item--selected':'');const text=document.createElement('div');text.className='van-ellipsis';text.textContent=item;option.append(text);option.onclick=()=>{chosen[index]=item;list.querySelectorAll('li').forEach(x=>x.classList.remove('van-picker-column__item--selected'));option.classList.add('van-picker-column__item--selected')};list.append(option);}});
    document.body.append(popup);}
   ['活动类型','活动级别','组织单位'].forEach((name,index)=>controls[name].parentElement.onclick=(e)=>{e.stopPropagation();picker([['校内服务','校级','虚构青协']],values=>controls[name].value=values[0]);});
   ['活动开始时间','活动结束时间'].forEach(name=>controls[name].parentElement.onclick=()=>picker([['2026'],['10','11'],['02','22'],['09','12'],['00']],v=>controls[name].value=v[0]+'-'+v[1]+'-'+v[2]+' '+v[3]+':'+v[4]));
   document.querySelector('#final').onclick=()=>fetch('/business/final',{method:'POST'});
  </script></div>`;
  const htmlPath = join(root, "offering.html");
  const configPath = join(root, "config.json");
  const resultPath = join(root, "result.json");
  await writeFile(htmlPath, html, "utf8");
  await writeFile(configPath, JSON.stringify({
    frame: true, html: htmlPath, result: resultPath, token: "ego-fixture-token",
    url: `${baseUrl.replace(/\/$/, "").replace("/gateway", "")}/mobile/volunteerManage/campusManagerApplyPages?activityPageTypes=Apply&activityCategory=SCHOOL_ACTIVITY`,
  }), "utf8");
  const command = join(root, "ego-browser");
  await writeFile(command, `#!/bin/sh\nFRIENDS_EGO_FIXTURE_CONFIG=${JSON.stringify(configPath)} exec node ${JSON.stringify(join(process.cwd(), "tests/fixtures/strict-ego.mjs"))}\n`, { mode: 0o700 });
  await chmod(command, 0o700);
  async function observed() { return JSON.parse(await (await import("node:fs/promises")).readFile(resultPath, "utf8")); }
  t.after(async () => await (await import("node:fs/promises")).rm(root, { recursive: true, force: true }));
  return { root, configPath, resultPath, command, observed };
}
