import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {identityPrivacy} from './identity-privacy.mjs';
export function migrateIdentityPrivacy({dir,archiveDir,backupRoots=[]}){
 const privacy=identityPrivacy(dir);fs.mkdirSync(archiveDir,{recursive:true,mode:0o700});
 function archive(file,destination){const bytes=fs.readFileSync(file),encrypted=privacy.encryptArchive(bytes);if(!privacy.decryptArchive(encrypted).equals(bytes))throw Error('加密归档校验失败');fs.writeFileSync(destination,encrypted,{flag:'wx',mode:0o600});return destination;}
 const database=path.join(dir,'visitor-audit.sqlite');const db=new DatabaseSync(database);db.exec('PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; PRAGMA wal_checkpoint(TRUNCATE)');
 archive(database,path.join(archiveDir,'visitor-audit.sqlite.privacy.enc'));
 let updated=0,events=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('DROP TRIGGER IF EXISTS events_no_update');
  for(const [table,columns,key] of [['applications',['form_json','detail_json','delivery_json'],'id'],['events',['payload'],'id']]){
   for(const row of db.prepare('SELECT '+key+','+columns.join(',')+' FROM '+table).all())for(const col of columns){const value=JSON.parse(row[col]),safe=privacy.protect(value);if(JSON.stringify(value)===JSON.stringify(safe))continue;db.prepare('UPDATE '+table+' SET '+col+'=? WHERE '+key+'=?').run(JSON.stringify(safe),row[key]);if(table==='events')events++;else updated++;}
  }
  for(const [table,columns] of [['applications',['applicant','host','department','phone','plate','email']],['visitors',['name','phone']]])for(const row of db.prepare('SELECT rowid AS privacy_rowid,'+columns.join(',')+' FROM '+table).all())for(const col of columns){const safe=privacy.protect(row[col]);if(safe!==row[col]){db.prepare('UPDATE '+table+' SET '+col+'=? WHERE rowid=?').run(safe,row.privacy_rowid);updated++;}}
  db.exec("CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'audit events cannot be updated'); END; COMMIT");
 }catch(e){db.exec('ROLLBACK');db.close();throw e;}
 db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite完整性检查失败');db.close();
 let jsonFiles=0,archived=0;
 for(const name of fs.readdirSync(dir)){if(!/\.json(?:\.tmp)?$/.test(name))continue;const file=path.join(dir,name);if(!fs.statSync(file).isFile())continue;const raw=JSON.parse(fs.readFileSync(file,'utf8')),safe=privacy.protect(raw);if(JSON.stringify(raw)===JSON.stringify(safe))continue;archive(file,path.join(archiveDir,name+'.privacy.enc'));const stat=fs.statSync(file),temp=file+'.privacy-tmp';fs.writeFileSync(temp,JSON.stringify(safe),{mode:0o600});if(process.platform!=='win32')fs.chownSync(temp,stat.uid,stat.gid);fs.renameSync(temp,file);jsonFiles++;}
 function walk(root){for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){walk(file);continue;}if(!entry.isFile()||!/(?:\.sqlite(?:-(?:wal|shm))?|\.json(?:\.tmp)?)$/.test(entry.name))continue;archive(file,file+'.privacy.enc');fs.unlinkSync(file);archived++;}}
 for(const root of backupRoots)if(fs.existsSync(root))walk(root);
 return {applicationFieldsUpdated:updated,eventPayloadsEncrypted:events,jsonFilesMigrated:jsonFiles,backupsEncrypted:archived,integrity:'ok'};
}
