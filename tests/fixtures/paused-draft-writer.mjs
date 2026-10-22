import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
// Pause the real atomic rename at the filesystem boundary while its store lock is held.
fs.rename = async () => {
  process.send({ready:'atomic-rename'});
  await new Promise(() => {});
};
syncBuiltinESMExports();
process.on('message', () => {});
const {createCertificationDraftStore}=await import('../../dist/node.js');
const {updateVolunteerCertificationDraft}=await import('../../dist/index.js');
const store=createCertificationDraftStore({root:process.argv[2]});
const draft=await store.load('crash-draft');
await store.save(updateVolunteerCertificationDraft(draft,{includedStudentNos:[]},0));
