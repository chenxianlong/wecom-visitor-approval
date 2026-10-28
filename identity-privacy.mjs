import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const instances=new Map();
export function identityPrivacy(dir){
 const file=path.resolve(dir,'.keys','identity.key');if(instances.has(file))return instances.get(file);
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 let key;try{key=fs.readFileSync(file);}catch(e){if(e.code!=='ENOENT')throw e;key=crypto.randomBytes(32);try{fs.writeFileSync(file,key,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;key=fs.readFileSync(file);}}
 if(key.length!==32)throw Error('身份证隐私密钥无效');fs.chmodSync(file,0o600);
 const aad=Buffer.from('wecom-identity-v1');
 function encrypt(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return 'encid:v1:'+Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
 function text(value){return value.replace(/(?<![0-9A-Za-z_])(?:[0-9]{17}[0-9Xx]|[0-9]{15})(?![0-9A-Za-z_])/g,encrypt);}
 function protect(value){if(typeof value==='string')return text(value);if(typeof value==='number'&&Number.isInteger(value)&&value>=1e14&&value<1e18)return encrypt(String(value));if(Array.isArray(value))return value.map(protect);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,protect(v)]));return value;}
 const out={protect,encryptArchive(bytes){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('wecom-privacy-archive-v1'));const data=Buffer.concat([c.update(bytes),c.final()]);return Buffer.concat([Buffer.from('WVCRENC1'),iv,c.getAuthTag(),data]);},decryptArchive(bytes){if(bytes.subarray(0,8).toString()!=='WVCRENC1')throw Error('无效的加密归档');const c=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));c.setAAD(Buffer.from('wecom-privacy-archive-v1'));c.setAuthTag(bytes.subarray(20,36));return Buffer.concat([c.update(bytes.subarray(36)),c.final()]);}};instances.set(file,out);return out;
}
