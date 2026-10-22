#!/usr/bin/env node
import {setupCertification} from '../tests/fixtures/certification-setup.mjs';
const cleanup=[];
const fixture=await setupCertification({after:fn=>cleanup.push(fn)});
console.log(JSON.stringify({config:fixture.config,baseUrl:fixture.options.baseUrl,draft:fixture.options.draft,session:fixture.options.session},null,2));
async function stop(){for(const fn of cleanup.reverse())await fn();process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
