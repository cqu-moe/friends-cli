import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export const organization = {
  uuid: "org-fixture",
  organizationName: "示例课程组织",
  organizationType: "CCYL",
  labelCode: "COURSE-LABEL",
};

export const session = {
  token: "course-fixture-token",
  userLevel: "XS",
  account: { userNo: "20210001", userName: "示例学生" },
  context: {
    levelNo: "XS",
    levelName: "学生",
    unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" },
  },
};

export const application = {
  schemaVersion: 1,
  kind: "course-offering",
  binding: {
    accountUserNo: "20210001",
    levelNo: "XS",
    unitNo: "24080",
    organizationId: "org-fixture",
  },
  uuid: null,
  firstStep: {
    curriculumName: "示例通识课程",
    curriculumType: "KCLX01",
    curriculumLevel: "LEVEL01",
    curriculumPlace: "A101",
    beginTime: "2026-10-01 08:00:00",
    endTime: "2026-10-31 18:00:00",
    curriculumContent: "受控课程介绍",
    role: { roleName: "参与者", integral: 0.5, classHour: 2 },
    attestationType: "AUTO",
    isOpenSign: true,
    signNumber: 1,
    isEnroll: true,
    isAppraise: true,
  },
  reportSet: {
    openType: "AUTO",
    openTime: "2026-09-20 08:00:00",
    finishType: "AUTO",
    deadline: "2026-10-30 18:00:00",
    isEnrollExamine: true,
    isHideList: false,
    isDraft: false,
    isOrgMember: false,
    limitCollegeNo: [],
    limitGrade: [],
    limitSpecialtyTypeOne: [],
    questionnaires: [],
    posts: [],
  },
  materials: {
    attachmentGroupUuid: null,
    publicityPicturesGroupUuid: null,
  },
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function reply(res, data, message = "success") {
  json(res, 200, { code: "0", message, data });
}

async function requestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function courseOfferingSchool(t) {
  const requests = [];
  const state = {
    mode: "ok",
    uploaded: [],
    courseCreated: false,
    courseUuid: null,
    finalSubmitted: false,
    organization,
    flowOverallState: 1,
    years: [{ schoolYear: "2026-2027", schoolYearName: "2026-2027学年", isCurrentYear: "1" }],
    terms: [{ termNo: "2", isCurrentTerm: "0" }, { termNo: "1", isCurrentTerm: "1" }],
  };
  const server = createServer(async (req, res) => {
    const body = await requestBody(req);
    let parsed = null;
    if (body.length > 0 && !(req.headers["content-type"] ?? "").includes("multipart/form-data")) {
      parsed = JSON.parse(body.toString("utf8"));
    }
    requests.push({
      method: req.method,
      url: req.url,
      contentType: req.headers["content-type"],
      appKey: req.headers["h-zove-appkey"],
      body: parsed ?? body,
    });
    const url = req.url ?? "";
    const path = new URL(url, "http://fixture").pathname;
    if (path.startsWith("/gateway/ek-agg-mob/biz-common/") && req.headers["h-zove-appkey"] !== "zovecenter-saip-ek-agg-mob") return json(res, 403, {});
    if (path.startsWith("/gateway/zovecenter-saip-ek-app-curriculum/") && req.headers["h-zove-appkey"] !== "zovecenter-saip-ek-app-curriculum") return json(res, 403, {});
    if (url === "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel") {
      return reply(res, {
        loginLevels: [{
          levelNo: "XS",
          levelName: "学生",
          units: [{ ...session.context.unit, unitNo: state.mode === "other-context" ? "other-unit" : session.context.unit.unitNo }],
        }],
        userLoginType: "STUDENT",
      });
    }
    if (url === "/gateway/ek-agg-mob/user/info") {
      return reply(res, { userNo: "20210001", userName: "示例学生" });
    }
    if (url === "/gateway/ek-agg-mob/user/enterHall") {
      return reply(res, {
        account: "20210001",
        name: "示例学生",
        userLoginStateLevel: "XS",
        departmentNo: "24080",
      });
    }
    if (url === "/gateway/ek-agg-mob/biz-common/system/vschool-year-list") {
      return reply(res, state.years);
    }
    if (url === "/gateway/ek-agg-mob/biz-common/term-list") {
      return reply(res, state.terms);
    }
    if (url === "/gateway/ek-agg-mob/biz-common/system/data-code-list/mulit") {
      assert.deepEqual(parsed, { codes: ["KCLX", "QNZYZXNHDJB"] });
      return reply(res, {
        KCLX: [{ dataCode: "KCLX01", dataName: "通识课" }],
        QNZYZXNHDJB: [{ dataCode: "LEVEL01", dataName: "校级" }],
      });
    }
    if (url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/organization/drop-down") {
      if (state.mode === "organization-denied") {
        return reply(res, []);
      }
      return reply(res, [state.organization]);
    }
    if (req.method === "POST" && url === "/gateway/ek-agg-mob/biz-common/protected-file-upload") {
      const raw = body.toString("utf8");
      const match = raw.match(/filename="([^"]+)"/);
      const fileName = match?.[1];
      if (state.mode === "upload-business") {
        return json(res, 200, { code: "10001", message: "school rejected upload" });
      }
      const groupUuid = raw.match(/name="groupId"\r\n\r\n([^\r]+)/)?.[1];
      if (!fileName || !groupUuid || !raw.includes('name="files"')) return json(res, 400, {});
      if (state.mode === "upload-forbidden" || (state.mode === "upload-forbidden-second" && state.uploaded.length === 1)) return json(res, 403, {});
      const resourceUuid = `resource-${state.uploaded.length + 1}`;
      state.uploaded.push({ resourceUuid, fileName, groupUuid });
      if (state.mode === "upload-lost" || (state.mode === "upload-lost-second" && state.uploaded.length === 2)) {
        res.destroy();
        return;
      }
      return reply(res, [resourceUuid]);
    }
    if (req.method === "POST" && path === "/gateway/ek-agg-mob/biz-common/list-group-resource") {
      return reply(res, state.uploaded.filter(item => item.groupUuid === new URL(url, "http://fixture").searchParams.get("groupUuid")).map((item) => ({
        uuid: item.resourceUuid,
        title: item.fileName?.replace(/\.[^.]+$/, ""),
        fileExtension: item.fileName?.match(/\.[^.]+$/)?.[0] ?? "",
      })));
    }
    if ((req.method === "POST" && url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/next-step") || (req.method === "PUT" && url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply")) {
      if (parsed.termNo !== "1" || parsed.organizationId !== "org-fixture" || parsed.applyLabelCode !== "COURSE-LABEL" || parsed.organizationType !== "LEAGUE") return json(res, 422, { message: "Course source context mismatch" });
    }
    if (req.method === "POST" && url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/next-step") {
      if (state.mode === "next-lost") {
        state.courseCreated = true;
        res.destroy();
        return;
      }
      state.courseCreated = true;
      state.courseUuid ??= "course-fixture";
      state.firstStep = parsed;
      return reply(res, state.courseUuid);
    }
    if (req.method === "POST" && url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/apply") {
      if (state.mode === "business-final") {
        return json(res, 200, { code: "10002", message: "course conflict" });
      }
      state.finalSubmitted = true;
      state.reportSet = parsed;
      state.flowOverallState = 5;
      if (state.mode === "final-ambiguous") return reply(res, false);
      if (state.mode === "final-lost") {
        res.destroy();
        return;
      }
      return reply(res, true, "提交成功");
    }
    if (req.method === "PUT" && url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply") {
      state.firstStep = parsed;
      if (state.mode === "update-lost") { res.destroy(); return; }
      return reply(res, true);
    }
    if (req.method === "GET" && url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/course-fixture") {
      if (state.mode === "status-forbidden" || (state.mode === "readback-forbidden" && state.finalSubmitted)) return json(res, 403, {});
      return reply(res, {
        uuid: "course-fixture",
        curriculumName: "示例通识课程",
        organizationId: state.mode === "wrong-organization" ? "other-org" : "org-fixture",
        organizationName: "示例课程组织",
        organizationType: "LEAGUE",
        flowOverallState: state.flowOverallState,
        curriculumState: state.finalSubmitted ? "PENDING" : "DRAFT",
        privateStudentList: [{ phone: "13800000000" }],
      });
    }
    return json(res, 404, {});
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/gateway`;
  return { baseUrl, requests, state };
}

export async function courseOfferingCliSetup(t, upstream) {
  const home = await mkdtemp(join(tmpdir(), "friends-course-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "drafts"), { mode: 0o700 });
  await writeFile(join(home, "session.json"), JSON.stringify({
    schemaVersion: 1,
    loginMethod: "local",
    storage: "file",
    ...session,
  }), { mode: 0o600 });
  return {
    home,
    env: {
      ...process.env,
      FRIENDS_HOME: home,
      FRIENDS_BASE_URL: upstream.baseUrl,
    },
  };
}

export async function installCourseOfferingEgoFixture(home, token = "course-fixture-token", url = "https://friends.cqu.edu.cn/mobile/course/courseInfo?type=add", options = {}) {
  const initial = { curriculumName: options.humanName ?? "", curriculumPlace: "", curriculumContent: "", curriculumType: "", curriculumLevel: "", organizationName: "", beginTime: "", endTime: "" };
  const field = (key, label, select = false) => {
    const multiline = key === "curriculumName" || key === "curriculumContent";
    const name = options.sourceSlots ? "" : ` name="${label}"`;
    const control = select
      ? options.sourceSlots ? `<div data-model="${key}">请选择</div>` : `<input${name} readonly style="pointer-events:none" data-model="${key}">`
      : multiline ? `<textarea${name} data-model="${key}"></textarea>` : `<input${name} data-model="${key}">`;
    const slot = select && options.sourceSlots ? `<div class="van-field__control van-field__control--custom"${options.previousPreparation ? ` data-friends-course-field="${key}"` : ""}>${control}</div>` : control;
    const title = `<div class="van-cell__title van-field__label"><label>${label}</label></div>`;
    if (options.sourceSlots && multiline) return `<div class="borderf5"><div class="van-cell">${title}</div></div><div class="borderf5"><div class="van-cell">${control}</div></div>`;
    return `<div class="van-cell">${title}<div class="van-cell__value"><div class="van-field__body">${slot}</div></div></div>`;
  };
  const html = `<!doctype html><meta charset="utf-8"><div class="cmine"><form>
    ${field('curriculumName','课程名称')}${field('curriculumType','课程类型',true)}${field('curriculumLevel','课程级别',true)}${field('organizationName','主办方',true)}
    ${field('beginTime','课程开始时间',true)}${field('endTime','课程结束时间',true)}${field('curriculumPlace','课程地址')}${field('curriculumContent','课程介绍')}
    <div class="van-cell"><div class="van-cell__title"><label>积分设置</label></div><div class="van-field__body"><div></div></div></div>
    <div class="van-cell"><div class="van-cell__title"><label>认证方式</label></div><div class="van-field__body"><div>请选择</div></div></div>
    <div class="van-uploader"><input type="file" name="publicityPicturesGroupUuid"></div><div class="van-uploader"><input type="file" name="attachmentGroupUuid"></div>
    <button type="button" id="next">下一步</button></form>
    <script>
    const model = window.__courseForm = ${JSON.stringify(initial)};
    function setValue(node,value){if(node.matches('input,textarea'))node.value=value;else node.textContent=value||'请选择';}
    for (const node of document.querySelectorAll('[data-model]')) { setValue(node,model[node.dataset.model]); node.oninput=()=>model[node.dataset.model]=node.value; }
    function picker(columns, apply, openingMs=0) {
      const popup=document.createElement('div'); popup.className='van-popup'; const panel=document.createElement('div'); panel.className='van-picker'; panel.getBoundingClientRect=()=>({width:858,height:308}); popup.append(panel); popup.style.display='none';let opening=openingMs>0;popup.getAnimations=()=>[{playState:opening?'running':'finished'}];if(opening)setTimeout(()=>opening=false,openingMs);
      const done=document.createElement('button'); done.type='button'; done.className='van-picker__confirm'; done.textContent='确认'; panel.append(done);
      const all=document.createElement('div'); all.className='van-picker__columns'; panel.append(all); const chosen=columns.map(c=>c[0]); const moving=columns.map(()=>false);
      columns.forEach((items,index)=>{ const col=document.createElement('div'); col.className='van-picker-column'; all.append(col); const list=document.createElement('ul'); list.className='van-picker-column__wrapper'; col.append(list); list.getAnimations=()=>[{playState:moving[index]?'running':'finished'}];
        items.forEach((item,i)=>{ const option=document.createElement('li'); option.className='van-picker-column__item'+(i===0?' van-picker-column__item--selected':''); const label=document.createElement('div'); label.className='van-ellipsis'; label.textContent=item; option.append(label); list.append(option);
          option.onclick=()=>{ moving[index]=true; list.querySelectorAll('li').forEach(n=>n.classList.remove('van-picker-column__item--selected')); option.classList.add('van-picker-column__item--selected'); setTimeout(()=>{chosen[index]=item;moving[index]=false;},25); };
        });
      });
      done.onclick=()=>{if(opening)return;apply(chosen);setTimeout(()=>{popup.style.display='none'},20);};document.body.append(popup);setTimeout(()=>{popup.style.display='block'},20);return popup;
    }
    const selections={curriculumType:${JSON.stringify(options.missingType ? ['其他类型'] : ['其他类型','通识课'])},curriculumLevel:${JSON.stringify(options.openingAnimation ? ['校级','其他级别'] : ['其他级别','校级'])},organizationName:['其他组织','示例课程组织']};
    for(const [key,values] of Object.entries(selections)) {
      const control=document.querySelector('[data-model="'+key+'"]');
      const trigger=control.matches('input')?control.parentElement:control;
      trigger.onclick=()=>{if(Array.from(document.querySelectorAll('.van-popup')).some(p=>p.style.display!=='none'))return;picker([values],v=>{model[key]=v[0];setValue(control,v[0]);},key==='curriculumLevel'&&${JSON.stringify(options.openingAnimation === true)}?250:0);};
    }
    for(const key of ['beginTime','endTime']) {
      const control=document.querySelector('[data-model="'+key+'"]');
      const trigger=control.matches('input')?control.parentElement:control;
      trigger.onclick=()=>{if(Array.from(document.querySelectorAll('.van-popup')).some(p=>p.style.display!=='none'))return;picker([['2026'],['09','10'],['01','31'],['08','18'],['00']],v=>{const value=v[0]+'-'+v[1]+'-'+v[2]+' '+v[3]+':'+v[4];model[key]=value;setValue(control,value);});};
    }
    if(${JSON.stringify(options.openPicker === true)}) picker([['人工选项']],()=>{}).style.display='block';
    document.querySelector('#next').onclick=()=>fetch('/business/course-next-step',{method:'POST',body:JSON.stringify(model)});
    </script></div>`;
  const htmlPath = join(home, "course.html");
  const config = join(home, "ego-config.json");
  const result = join(home, "observed.json");
  const bin = join(home, "bin");
  const command = join(bin, "ego-browser");
  await writeFile(htmlPath, html);
  await writeFile(config, JSON.stringify({ html: htmlPath, result, token, url, outerUrl: `${new URL(url).origin}/mobile/stuhall`, frame: true, executeSession: true, unreliablePickerWait: options.unreliablePickerWait === true }));
  await mkdir(bin, { recursive: true });
  const runner = pathToFileURL(resolve("tests/fixtures/strict-ego.mjs")).href;
  await writeFile(command, `#!/usr/bin/env node\nawait import(${JSON.stringify(runner)});\n`, { mode: 0o700 });
  return { config, result, command, bin };
}

export async function writeMaterialPlan(path, applicationValue = application) {
  const file = join(path, "course.txt");
  await writeFile(file, "controlled course material", { mode: 0o600 });
  await writeFile(join(path, "poster.png"), "controlled-poster", { mode: 0o600 });
  return {
    ...applicationValue,
    materials: {
      ...applicationValue.materials,
      files: [
        { kind: "attachment", path: file },
        { kind: "publicity", path: join(path, "poster.png") },
      ],
    },
  };
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export const cliPath = resolve("dist/cli/main.js");
