#!/usr/bin/env node
import {JSDOM} from 'jsdom';
import {readFile,writeFile} from 'node:fs/promises';
let script='';for await(const chunk of process.stdin)script+=chunk;
if(script.includes('FRIENDS_CLI_EGO_SESSION:')) {console.log('FRIENDS_CLI_EGO_SESSION:'+JSON.stringify({token:'ego-fixture-token',userLevel:'XS'}));process.exit(0);}
const configuration=JSON.parse(await readFile(process.env.FRIENDS_EGO_FIXTURE_CONFIG,'utf8'));
const stats={clicks:[],fills:[],handoffs:0,navigations:0,submits:0,snapshots:0};
const dom=new JSDOM(await readFile(configuration.html,'utf8'),{url:configuration.url,runScripts:'dangerously',beforeParse(w){
 w.fetch=async(url,init)=>{if(init?.method==='POST')stats.submits++;return fetch(new URL(url,configuration.url),init);};
 w.localStorage.setItem('token_str',configuration.token??'ego-fixture-token');w.localStorage.setItem('userLevel_str','XS');
}});
const w=dom.window;
function visible(element){for(let current=element;current;current=current.parentElement)if(w.getComputedStyle(current).display==='none')return false;return true;}
function matches(selector){
 if(selector.startsWith('text=')){const value=JSON.parse(selector.slice(5));return [...w.document.querySelectorAll('button,div,span')].filter(e=>visible(e)&&e.textContent.trim()===value&&![...e.children].some(child=>child.textContent.trim()===value));}
 const css=selector.replace(/^loc=css:/,'');
 const text=css.match(/:text-is\((".*")\)$/);const base=text?css.slice(0,text.index):css;
 return [...w.document.querySelectorAll(base)].filter(e=>visible(e)&&(!text||e.textContent.trim()===JSON.parse(text[1])));
}
function one(selector){const elements=matches(selector);if(elements.length!==1)throw new Error(`Expected exactly one visible match: ${selector}, got ${elements.length}`);return elements[0];}
function active(){if(stats.handoffs)throw new Error('Browser operation after handOff');}
const page={
 async url(){active();return configuration.url;},
 async goto(){stats.navigations++;throw new Error('Unexpected navigation would discard fixture edits');},
 async snapshot(){active();stats.snapshots++;if(configuration.changeOnSecondSnapshot&&stats.snapshots===2){w.document.querySelector('#edit input[name=requiredCourseCount]').value='9';w.document.querySelector('.hours span:last-child').textContent='9';}return w.document.body.textContent;},
 async evaluate(fn,arg){active();w.__argument=structuredClone(arg);return JSON.parse(JSON.stringify(await w.eval(`(${fn.toString()})(__argument)`)));},
 async waitForFunction(fn,arg){active();w.__argument=structuredClone(arg);if(!await w.eval(`(${fn.toString()})(__argument)`))throw new Error('Fixture never became ready');},
 async click(selector){active();const e=one(selector);stats.clicks.push(selector);e.click();},
 async fill(selector,value){active();const e=one(selector);if(e.disabled)throw new Error('Cannot fill disabled input');stats.fills.push(selector);e.value=value;e.dispatchEvent(new w.Event('input',{bubbles:true}));e.dispatchEvent(new w.Event('change',{bubbles:true}));},
 async waitForSelector(selector,{state='visible'}={}){active();for(let i=0;i<30;i++){const list=matches(selector);if(state==='hidden'?list.length===0:list.length>0)return;await new Promise(r=>setTimeout(r,10));}throw new Error('Waiting for selector failed: '+selector);},
};
const task={page(){return page},async handOff(){active();stats.handoffs++;}};
try {await new Function('taskSpace',`return (async()=>{${script}})()`)(async()=>task);}
finally {await writeFile(configuration.result,JSON.stringify({...stats,html:w.document.body.innerHTML}));dom.window.close();}
