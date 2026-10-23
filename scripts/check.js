import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
async function files(directory){const found=[];for(const entry of await readdir(directory,{withFileTypes:true})){const url=new URL(entry.name+(entry.isDirectory()?'/':''),directory);if(entry.isDirectory())found.push(...await files(url));else if(entry.name.endsWith('.js'))found.push(fileURLToPath(url));}return found;}
let failed=false;
for(const directory of ['src','public','scripts','test'])for(const file of await files(new URL(`../${directory}/`,import.meta.url))){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status){failed=true;process.stderr.write(result.stderr);}}
const manifest=JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
for(const icon of manifest.icons)await access(new URL(`../public${icon.src}`,import.meta.url));
JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
if(failed)process.exitCode=1;else console.log('JavaScript syntax, package metadata, manifest, and icon files are valid.');
