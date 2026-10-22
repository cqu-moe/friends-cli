#!/usr/bin/env node
import {JSDOM} from 'jsdom';
import {readFile,writeFile} from 'node:fs/promises';
let script='';for await(const chunk of process.stdin)script+=chunk;
const configuration=JSON.parse(await readFile(process.env.FRIENDS_EGO_FIXTURE_CONFIG,'utf8'));
if(!configuration.executeSession&&script.includes('FRIENDS_CLI_EGO_SESSION:')) {console.log('FRIENDS_CLI_EGO_SESSION:'+JSON.stringify({token:'ego-fixture-token',userLevel:'XS'}));process.exit(0);}

const stats={clicks:[],fills:[],handoffs:0,navigations:0,submits:0,remoteWrites:0,snapshots:0};
const html=await readFile(configuration.html,'utf8');
const domOptions={url:configuration.url,runScripts:'dangerously',beforeParse(w){
 w.fetch=async(url,init)=>{if(['POST','PUT','PATCH','DELETE'].includes(init?.method?.toUpperCase()))stats.remoteWrites++;if(init?.method==='POST')stats.submits++;return fetch(new URL(url,configuration.url),init);};
 w.localStorage.setItem('token_str',configuration.token??'ego-fixture-token');w.localStorage.setItem('userLevel_str',configuration.userLevel??'XS');
 for(const key of ['userInfo_obj','account_str','loginModel_str'])w.localStorage.setItem(key,'fixture');
}};
const contentDom=new JSDOM(html,domOptions);
const dom=configuration.frame?new JSDOM('<iframe></iframe>',{...domOptions,url:configuration.outerUrl??configuration.url}):contentDom;
if(configuration.frame){const frame=dom.window.document.querySelector('iframe');Object.defineProperty(frame,'contentDocument',{get:()=>contentDom.window.document});Object.defineProperty(frame,'contentWindow',{get:()=>contentDom.window});}
const w=dom.window,d=contentDom.window.document;
let saved=configuration.state?JSON.parse(await readFile(configuration.state,'utf8').catch(()=>'{"ownership":"agent"}')):{ownership:'agent'};
if(configuration.partialEditor){d.querySelector('#edit').classList.add('open');}
if(saved.rows){w.__rows=saved.rows;w.eval('rows.splice(0,rows.length,...__rows);render()');}

function visible(element){for(let current=element;current;current=current.parentElement)if(w.getComputedStyle(current).display==='none')return false;return true;}
function matches(selector,includeHidden=false){
 if(selector.startsWith('text=')){const value=JSON.parse(selector.slice(5));return [...d.querySelectorAll('button,div,span')].filter(e=>visible(e)&&e.textContent.trim()===value&&![...e.children].some(child=>child.textContent.trim()===value));}
 if(selector.startsWith('xpath=')){const result=d.evaluate(selector.slice(6),d,null,7,null);return Array.from({length:result.snapshotLength},(_,i)=>result.snapshotItem(i)).filter(visible);}
 const css=selector.replace(/^loc=css:/,'');
 const text=css.match(/:(?:text-is|has-text)\((".*")\)$/);const base=text?css.slice(0,text.index):css;
 return [...d.querySelectorAll(base)].filter(e=>(includeHidden||visible(e))&&(!text||(css.includes(':has-text(')?e.textContent.trim().includes(JSON.parse(text[1])):e.textContent.trim()===JSON.parse(text[1]))));
}
function one(selector){const elements=matches(selector);if(elements.length!==1)throw new Error(`Expected exactly one visible match: ${selector}, got ${elements.length}`);return elements[0];}
function active(){if(saved.ownership==='user'||stats.handoffs)throw new Error('Browser operation after handOff');}
const page={
 async url(){active();return configuration.outerUrl??configuration.url;},
 async goto(){stats.navigations++;throw new Error('Unexpected navigation would discard fixture edits');},
 async snapshot(){active();stats.snapshots++;if(configuration.changeOnSecondSnapshot&&stats.snapshots===2){d.querySelector('#edit input[name=requiredCourseCount]').value='9';d.querySelector('.hours span:last-child').textContent='9';}return d.body.textContent;},
 async evaluate(fn,arg){active();if(arguments.length>1&&arg===undefined)throw new Error("page.evaluate argument must be JSON-serializable");w.__argument=structuredClone(arg);return JSON.parse(JSON.stringify(await w.eval(`(${fn.toString()})(__argument)`)));},
 async waitForFunction(fn,arg){active();w.__argument=structuredClone(arg);for(let i=0;i<30;i++){if(await w.eval(`(${fn.toString()})(__argument)`))return;await new Promise(r=>setTimeout(r,10));}throw new Error('Fixture never became ready');},
 async click(selector,options){active();if(selector==="loc=css:.van-overlay"&&!options?.position)throw new Error("Popup intercepts the overlay center");const e=one(selector);if(w.getComputedStyle(e).pointerEvents==="none")throw new Error("Field body intercepts input pointer events");stats.clicks.push(selector);e.click();},
 async fill(selector,value){active();const e=one(selector);if(e.disabled)throw new Error('Cannot fill disabled input');stats.fills.push(selector);e.value=value;e.dispatchEvent(new contentDom.window.Event('input',{bubbles:true}));e.dispatchEvent(new contentDom.window.Event('change',{bubbles:true}));},
 async waitForSelector(selector,{state='visible'}={}){active();if(matches(selector,true).length>1)throw new Error('Ambiguous wait selector including hidden elements');for(let i=0;i<30;i++){const list=matches(selector);if(state==='hidden'?list.length===0:list.length>0)return;await new Promise(r=>setTimeout(r,10));}throw new Error('Waiting for selector failed: '+selector);},
};
const task={page(){return page},async handOff(){active();stats.handoffs++;saved.ownership='user';}};
try {await new Function('taskSpace','takeOverTaskSpace',`return (async()=>{${script}})()`)(async()=>task,async()=>{saved.ownership='agent';return task;});}
finally {if(configuration.state)await writeFile(configuration.state,JSON.stringify({ownership:saved.ownership,rows:JSON.parse(w.eval('JSON.stringify(rows)'))}));await writeFile(configuration.result,JSON.stringify({...stats,model:contentDom.window.__courseForm??null,html:d.body.innerHTML}));dom.window.close();if(contentDom!==dom)contentDom.window.close();}
