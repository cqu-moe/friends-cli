import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function leaderEgoFixture(t, baseUrl, mode="clean") {
  const root=await mkdtemp(join(tmpdir(),"friends-leader-ego-")); t.after(()=>rm(root,{recursive:true,force:true}));
  const command=join(root,"ego-browser"), script=join(root,"script.js"), evidence=join(root,"evidence.json");
  const runner=new URL("./ego-organization-leader-page.mjs",import.meta.url).href;
  const quote=s=>"'"+s.replaceAll("'", "'\\''")+"'";
  await writeFile(command,`#!/bin/sh\ncat > ${quote(script)}\nexport LEADER_EGO_CONFIG=${quote(JSON.stringify({baseUrl,mode,script,evidence}))}\nexec ${quote(process.execPath)} -e ${quote(`await import(${JSON.stringify(runner)})`)}\n`); await chmod(command,0o700);
  return { command, evidence };
}
