#!/usr/bin/env node
import {JSDOM} from 'jsdom';
import {readFile,writeFile} from 'node:fs/promises';
let script='';for await(const chunk of process.stdin)script+=chunk;
const configuration=JSON.parse(await readFile(process.env.FRIENDS_EGO_FIXTURE_CONFIG,'utf8'));
configuration.iframe ||= configuration.frame;
if(!configuration.executeSession&&script.includes('FRIENDS_CLI_EGO_SESSION:')) {
  console.log('FRIENDS_CLI_EGO_SESSION:'+JSON.stringify({token:'ego-fixture-token',userLevel:'XS'}));
  process.exit(0);
}
const stats={clicks:[],fills:[],handoffs:0,newPages:0,navigations:0,loadStates:0,submits:0,remoteWrites:0,finalRequests:0,snapshots:0,captures:0};
const html=await readFile(configuration.html,'utf8');
function initialize(w){
  w.fetch=async(url,init)=>{
    const method=(init?.method??'GET').toUpperCase();
    if(['POST','PUT','PATCH','DELETE'].includes(method))stats.remoteWrites++;
    if(method==='POST')stats.submits++;
    if(['/write','/quit'].includes(new URL(url,configuration.url).pathname)&&method!=='GET')stats.finalRequests++;
    return fetch(new URL(url,configuration.url),init);
  };
  w.localStorage.setItem('token_str',configuration.token??'ego-fixture-token');
  w.localStorage.setItem('userLevel_str',configuration.userLevel??'XS');
  w.localStorage.setItem('account_str',configuration.accountUserNo??'20210001');
  w.localStorage.setItem('loginModel_str','STUDENT');
  w.localStorage.setItem('userInfo_obj',JSON.stringify({userNo:configuration.accountUserNo??'20210001'}));
}
const dom=new JSDOM(configuration.iframe?`<iframe src="${configuration.url}"></iframe>`:html,{url:configuration.outerUrl??configuration.url,runScripts:'dangerously',beforeParse:initialize});
const w=dom.window;
const d=configuration.iframe?w.document.querySelector('iframe').contentDocument:w.document;
const content=d.defaultView;
if(configuration.iframe){
 initialize(content);
 d.open();d.write(html);d.close();
}

if(!script.includes('FRIENDS_CLI_EGO_SESSION:')){
 if(configuration.preparationToken)content.localStorage.setItem('token_str',configuration.preparationToken);
 if(configuration.preparationRole)content.localStorage.setItem('userLevel_str',configuration.preparationRole);
}
let saved=configuration.state?JSON.parse(await readFile(configuration.state,'utf8').catch(()=>'{"ownership":"agent"}')):{ownership:'agent'};
if(configuration.partialEditor){d.querySelector('#edit').classList.add('open');}
if(saved.rows){
  content.__rows=saved.rows;
  content.eval('rows.splice(0,rows.length,...__rows);render()');
}
function visible(element){
  for(let current=element;current;current=current.parentElement)if(w.getComputedStyle(current).display==='none')return false;
  return true;
}
function matches(selector,includeHidden=false){
  if(selector.startsWith('text=')){
    const raw=selector.slice(5);
    const value=raw.startsWith('"')?JSON.parse(raw):raw;
    return [...d.querySelectorAll('button,[role=button],.van-cell,div,span')]
      .filter(e=>(includeHidden||visible(e))&&e.textContent.trim()===value&&![...e.children].some(child=>child.textContent.trim()===value));
  }
  if(selector.startsWith('xpath=')){
    const result=d.evaluate(selector.slice(6),d,null,w.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);
    return Array.from({length:result.snapshotLength},(_,index)=>result.snapshotItem(index)).filter(e=>includeHidden||visible(e));
  }
  const css=selector.replace(/^loc=css:/,'');
  const text=css.match(/:(?:text-is|has-text)\((".*")\)$/);
  const base=text?css.slice(0,text.index):css;
  return [...d.querySelectorAll(base)].filter(e=>(includeHidden||visible(e))&&(!text||(css.includes(':has-text(')?e.textContent.trim().includes(JSON.parse(text[1])):e.textContent.trim()===JSON.parse(text[1]))));
}
function one(selector){
  const elements=matches(selector);
  if(elements.length!==1)throw new Error(`Expected exactly one visible match: ${selector}, got ${elements.length}`);
  return elements[0];
}
function active(){if(saved.ownership==='user'||stats.handoffs)throw new Error('Browser operation after handOff');}
const page={
  label:'p1',
  async url(){active();return configuration.outerUrl??configuration.url;},
  async goto(){active();stats.navigations++;throw new Error('Unexpected navigation would discard fixture edits');},
  async waitForLoadState(){active();stats.loadStates++;},
  async snapshot(){
    active();
    stats.snapshots++;
    if(configuration.failSnapshotAt===stats.snapshots)throw new Error("Final snapshot connection lost");
    if(configuration.changeOnSecondSnapshot&&stats.snapshots===2){
      d.querySelector('#edit input[name=requiredCourseCount]').value='9';
      d.querySelector('.hours span:last-child').textContent='9';
    }
    return d.body.textContent;
  },
  async evaluate(fn,arg){
    active();
    if(arguments.length>1&&arg===undefined)throw new Error('page.evaluate argument must be JSON-serializable');
    w.__argument=structuredClone(arg);
    const result=JSON.parse(JSON.stringify(await w.eval(`(${fn.toString()})(__argument)`)));
    if(result?.fields && typeof result.publicity==='number'){
      stats.captures++;
      if(configuration.failCaptureAt===stats.captures)throw new Error('Final capture connection lost');
    }
    return result;
  },
  async waitForFunction(fn,arg){
    active();
    if(configuration.unreliablePickerWait&&typeof arg==='boolean'){
      await new Promise(resolve=>setTimeout(resolve,30));
      throw new Error('Fixture function wait lost the live iframe popup transition');
    }
    w.__argument=structuredClone(arg);
    for(let attempt=0;attempt<30;attempt++){
      if(await w.eval(`(${fn.toString()})(__argument)`))return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('Fixture never became ready');
  },
  async click(selector,options){
    active();
    if(selector==="loc=css:.van-overlay"&&!options?.position)throw new Error('Popup intercepts the overlay center');
    const element=one(selector);
    if(w.getComputedStyle(element).pointerEvents==="none")throw new Error('Field body intercepts input pointer events');
    stats.clicks.push(selector);
    element.click();
  },
  async fill(selector,value){
    active();
    const element=one(selector);
    if(element.disabled||element.readOnly)throw new Error('Cannot fill disabled or readonly input');
    stats.fills.push(selector);
    element.value=value;
    element.dispatchEvent(new content.Event('input',{bubbles:true}));
    element.dispatchEvent(new content.Event('change',{bubbles:true}));
    if(configuration.failAfterFill===stats.fills.length)throw new Error('Lost visible fill acknowledgement');
  },
  async waitForSelector(selector,{state='visible'}={}){
    active();
    if(configuration.unreliablePickerWait&&selector.includes('.van-picker')&&state==='visible'){
      await new Promise(resolve=>setTimeout(resolve,30));
      throw new Error('Fixture locator wait lost the live iframe picker');
    }
    if(matches(selector,true).length>1)throw new Error('Ambiguous wait selector including hidden elements');
    for(let i=0;i<30;i++){
      const list=matches(selector);
      if(state==='hidden'?list.length===0:list.length>0)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('Waiting for selector failed: '+selector);
  },
};
const task={
  page(){return page;},
  async newPage(){active();stats.newPages++;return {...page,async goto(){active();stats.navigations++;}};},
  async handOff(){active();stats.handoffs++;saved.ownership='user';if(configuration.failHandoff)throw new Error('Handoff acknowledgement lost');},
};
try {
  const bridgeConsole={log(value){
    const match=typeof value==='string'&&value.match(/^(FRIENDS_[A-Z_]*(?:PREPARE|REVIEW):)/);
    if(match&&configuration.receipt){
      const modes={empty:'{}',malformed:'{',invalidHandoff:JSON.stringify({...JSON.parse(value.slice(match[1].length)),handoff:{malformed:true}}),noHandoff:JSON.stringify({...JSON.parse(value.slice(match[1].length)),handoff:undefined})};
      console.log(match[1]+modes[configuration.receipt]);
    }else console.log(value);
  }};
  await new Function('taskSpace','takeOverTaskSpace','console',`return (async()=>{${script}})()`)(async()=>task,async()=>{
    saved.ownership='agent';
    return task;
  },bridgeConsole);
} finally {
  if(configuration.state){
    let rows=null;
    try{rows=JSON.parse(content.eval('JSON.stringify(rows)'));}catch{}
    await writeFile(configuration.state,JSON.stringify({ownership:saved.ownership,rows}));
  }
  await writeFile(configuration.result,JSON.stringify({
    ...stats,
    model:content.__courseForm??null,
    html:d.body.innerHTML,
    fieldValues:[...d.querySelectorAll('input,textarea')].map(e=>({id:e.id||null,ariaLabel:e.getAttribute('aria-label'),value:e.value})),
  }));
  dom.window.close();
}
