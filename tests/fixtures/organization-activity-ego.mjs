import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function setupOrganizationActivityEgo(t,baseUrl,{humanName='人工草稿标题',readonlyPlace=false,browserAccount='20210001'}={}){
 const home=await mkdtemp(join(tmpdir(),'friends-org-activity-ego-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const html=join(home,'page.html'),result=join(home,'observed.json'),config=join(home,'ego.json'),command=join(home,'ego-browser');
 await writeFile(html,`<!doctype html><meta charset="utf-8"><div class="main"><form>
 <div class="van-field"><div class="van-field__label">发起组织</div><input readonly value="示例组织"></div>
 <div>活动名称</div><textarea>${humanName}</textarea>
 <div class="van-field"><div class="van-field__label">活动开始时间</div><input readonly></div>
 <div class="van-field"><div class="van-field__label">活动结束时间</div><input readonly></div>
 <div class="van-field"><div class="van-field__label">活动地址</div><input ${readonlyPlace?'readonly':''}></div>
 <div>活动简介</div><textarea></textarea>
 <div class="van-uploader"><input type="file"></div><div class="van-uploader"><input type="file"></div>
 <button type="button" id="next">下一步</button></form></div><script>
 document.querySelectorAll('input,textarea').forEach(input=>input.addEventListener('input',()=>input.dataset.model=input.value));
 document.querySelector('#next').onclick=()=>fetch('${new URL(baseUrl).origin}/gateway/zovecenter-saip-ek-app-team-organization-manage/mob/apply-info/next-update',{method:'PUT',body:'{}'});
 </script>`);
 await writeFile(config,JSON.stringify({html,result,url:baseUrl.replace('/gateway','/mobile/acManage/stuFirst?type=ADD'),iframe:true,executeSession:true,accountUserNo:browserAccount}));
 await writeFile(command,`#!${process.execPath}\nawait import(${JSON.stringify(new URL('./strict-ego.mjs',import.meta.url).href)});\n`,{mode:0o700});
 return {home,config,command,async observed(){return JSON.parse(await readFile(result,'utf8'));},env:{...process.env,FRIENDS_EGO_FIXTURE_CONFIG:config,FRIENDS_EGO_COMMAND:command,PATH:home+':'+process.env.PATH}};
}
