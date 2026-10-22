# #18 有界端点与页面契约审计

范围仅为 organization-activities 的公开/可管理查询、详情/要求/状态、开办准备、材料上传/资源回读、第一步保存、第二步设置与第一步可见文本准备。不新增业务能力，不调用生产写接口，不涉及 #19/#20。来源为已保存的公开模块快照与主线程单独执行的真实只读/文本诊断。

## 端点映射

以下 team 路径完整前缀为 `/gateway/zovecenter-saip-ek-app-team-organization-manage/mob`，AppKey `zovecenter-saip-ek-app-team-organization-manage`；common 前缀为 `/gateway/ek-agg-mob/biz-common`，AppKey `zovecenter-saip-ek-agg-mob`。表格根据调用模块的 import、工厂 export 和请求定义逐层核对，未从 SDK 实现反向生成。

| 能力 | 调用与导出链 | 方法及相对路径 | 独立契约/副作用 |
| --- | --- | --- | --- |
| 公开列表 | index.5fa98249 的 J ← team export a ← i | POST team `/apply-info/activity-page-list` | currentPage/pageSize/key/approve:false；只读 |
| 自己开办记录 | activityApply.5e72e07a 的 Ee ← team export k ← u | POST team `/apply-info/my-page-list` | 分页与 key；只读；不把取消函数 export i 当列表 |
| 详情、要求 | detail.bb008e63 的 C、firstStep 的 ye、secondStep 的 Re ← export f ← y | GET team `/apply-info/{uuid}` | 只读；详情 UUID 必须匹配 |
| 申请节点/历史 | detail 的 D、firstStep 的 ve ← common export A ← O | POST common `/flow/approve-list` | businessTypeCode=组织活动申请流程、applyId、branchNo:""；只读 |
| 可选发起组织 | firstStep 的 ce ← team export d ← q | POST team `/apply-info/drop-down-list` | 精确 body {isTeacher:false}；uuid/organizationName/organizationType；只读权限依据 |
| 默认学期 | firstStep 的 be ← common export M ← q | POST common `/term-list` | 无 body；isCurrentTerm == 1；只读 |
| 第一步保存 | firstStep 的 Fe ← team export n ← l | PUT team `/apply-info/next-update` | 保存即发生远程副作用；code 0 的 data 返回申请 UUID |
| 第二步设置 | secondStep 的 Ie ← team export u ← p | PUT team `/apply-info/set-update` | 远程设置/提交；不得由 Ego 自动执行 |
| 图片与附件上传 | 图片 K、附件 $ ← common export q ← L | POST common `/protected-file-upload` | multipart files + groupId；返回 data[0] 资源 ID；远程副作用 |
| 资源组回读 | 图片 W ← export x ← U；附件 H ← export h ← v | POST common `/list-group-resource?groupUuid=...` | 只读；附件形式 body null 与 form-urlencoded Header；uuid/title/fileExtension 用于回读 |

源码确认 `chose-type` 是 team export t ← d，供 secondStep 的 Pe 读取类型选项，不能用于开办组织权限。主线程实际读到它为 code/name 字典数组 9 项；fixture 保留独立的字典响应以防旧错误再次被伪装成权限成功。node-list-no-state 也保持独立的三项数组形状，不伪装为 approve-list 的对象。

## 字段审计与修复

组织选择已从错误 GET chose-type 改为 POST drop-down-list({isTeacher:false})。主线程实际只读核验 HTTP 200/code 0、数组 1 项，字段含 uuid/organizationName/organizationType；真实值保留私有，未进入仓库。权限与当前账号绑定仍逐次重新验证，不放宽未知组织或权限撤销检查。

学期字段无需改名。主线程确认 term-list 为 26 项，使用 isCurrentTerm 字符串 "1"/"0"，不存在 isCurrent。本实现保留字符串 "1" 支持，不增加 isCurrent 别名猜测。fixture 使用非当前 "0" 与唯一当前 "1" 两项代表已核实形状，测试缺失、无当前及多个当前均拒绝默认选择。主线程随后直接使用当前真实组织与学校学期运行 SDK prepare 成功，返回 materials-required，未上传或保存。

第一步字段逐项对照 firstStep 的 a 初始模型：学年/学期、组织、活动名称/简介/地址、起止时间、图片/附件组、空 uuid。组织类型按源码 CCYL→1、其他学校返回类型→3。第二步对照初始 e 与 ye 读取：四个布尔开关、1–8 次签到、显式权限/报名条件标志、TIMING_ON 起止方式与时间、applyNumber:0、draft:false、push:true、空问卷和 UUID；补齐此前遗漏的 activityName 与 beginTime。显示派生 time 不作为持久业务字段。

第二步源码的新增条件分支为 ADD/APPLY→addOrUpdate:2，其他→1；同时快照存在 typeFrom 与 type 属性混用。SDK 明确只实现新建计划并沿用 ADD 分支的 2，不声称已核验真实最终页面的网络 payload 或服务器写入结果；这个源码歧义保留为生产写入验收限制，没有通过推测另一个值或真实写入绕过。

图片组件使用 PNG/JPG/JPEG/GIF/BMP MIME、20 MiB 上限；附件组件扩展名白名单与普通 20 MiB/视频 200 MiB 上限已逐项核对。图片组件自身存在压缩步骤，当前 API 上传标准 File，不声称复现浏览器压缩/解码；这仍是明确的生产材料验收限制。两类上传均使用 files/groupId 与相同上传端点，资源回读使用学校返回的 ID、标题和扩展名，不伪造字节校验。

## fixture 与回归证据

fixture 的路径、方法和应用头为上述源码字面契约：错误方法/应用头拒绝，组织 body 必须精确，term-list 无 body，资源组回读要求正确 query、空 body 与内容类型；未引用生产模块的路由常量。组织旧实现先在公开 SDK 与真实 CLI 复现 PERMISSION_DENIED（CLI exit 4），修复后再绿。最终设置请求先因缺失 activityName/beginTime 失败，再补齐。既有 SDK 成功链扩展为图片加附件，独立断言第一步/第二步完整 payload、资源组与两次上传；保持所有响应丢失、部分操作、权限撤销和不重试用例。

真实状态查询由主线程验证节点 3 项、历史 2 项。真实页面 helper 的文本诊断也已通过：标题/简介/地址录入、executionError:null、submitted:false；诊断抑制 handoff，未触发下一步、上传或最终提交；重新加载后文本与上传均清空。不把这次诊断说成完整 CLI handoff 或业务写入验收。组织 custom DIV slot 已按同一 bundle 的 Field 渲染器修正只读检测：index.476541f9.js 的 ue("field") 生成 van-field 命名空间，pe() 对 input slot 生成 van-field__control--custom，stuFirst 在其中输出组织名称 DIV。fixture 使用该真实结构；匹配组织不误报待选，人工另选组织保持原文并禁止文本填写，源码占位“请选择”保持待人工选择。读取不声称改变组织，组织选择始终留给用户。

## 快照指纹

SHA-256 前缀仅标识本次审计读取的快照，不表示当前线上版本永远相同：

| 模块 | SHA-256 前缀 |
| --- | --- |
| index.476541f9.js（Field 渲染器） | 07046d2d0902a157 |
| index.ab6e178e.js | 7d1523397e1c76b0 |
| common.b21a4484.js | 3cc383854d67d50b |
| firstStep.95354968.js | c9c81e2b62f227b7 |
| secondStep.0d43cb1b.js | cf1db305e45134c5 |
| detail.bb008e63.js | e10019cde4efad6f |
| index.5fa98249.js | ca3528ca61d14b31 |
| activityApply.5e72e07a.js | 10e696b3a50c7e08 |
| index.d1c12659.js | d1d1dba694630a6b |
| fileUploder.709dc576.js | 49f193d49c171a17 |

本工作线程未访问真实 Ego、GitHub、生产 API，未 push；所有真实结果均明确来自主线程。真实材料上传、两步写入、用户最终提交与业务回查仍未验收。

本次 #18 定向构建与公开 SDK/真实 CLI/实际 iframe 回调测试为 18/18 通过，0 failed/skipped。最终集成全量结果见工作线程交接记录；定向通过不替代上述尚未执行的生产写入验收。
