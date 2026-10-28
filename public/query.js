const $=s=>document.querySelector(s);let csrf,busy=false,revision=0,results=[],resultIdentity=null;
const storageKey='visitor-query-identity-v4',legacyKey='visitor-query-identity-v3',identityLifetime=7*24*60*60*1000,phonePattern=/^1[3-9]\d{9}$/;
function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
function forgetIdentity(){try{localStorage.removeItem(storageKey);localStorage.removeItem(legacyKey);localStorage.removeItem('visitor-query-identity-v1');localStorage.removeItem('visitor-query-identity-v2');}catch{}$('#forgetQuery').hidden=true;}
function readIdentity(){try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&typeof saved.hostName==='string'&&saved.hostName.trim().length>0&&saved.hostName.length<=50&&typeof saved.visitorName==='string'&&saved.visitorName.trim().length>0&&saved.visitorName.length<=50&&phonePattern.test(saved.phone)&&validDate(saved.date)&&Number.isFinite(saved.expiresAt)&&saved.expiresAt>Date.now()&&saved.expiresAt<=Date.now()+identityLifetime)return saved;}catch{}try{localStorage.removeItem(storageKey);}catch{}return null;}
function rememberIdentity(identity){try{localStorage.setItem(storageKey,JSON.stringify({...identity,expiresAt:Date.now()+identityLifetime}));localStorage.removeItem(legacyKey);localStorage.removeItem('visitor-query-identity-v1');localStorage.removeItem('visitor-query-identity-v2');$('#forgetQuery').hidden=false;}catch{}}
const saved=readIdentity(),preferred=new URL(location.href).searchParams.get('sp_no');
$('#queryDate').value=new Date(Date.now()+28800000).toISOString().slice(0,10);
if(saved){$('#queryHostName').value=saved.hostName;$('#queryVisitorName').value=saved.visitorName;$('#queryPhone').value=saved.phone;$('#queryDate').value=saved.date;$('#forgetQuery').hidden=false;}
else try{const legacy=JSON.parse(localStorage.getItem(legacyKey));if(legacy&&phonePattern.test(legacy.phone)&&legacy.expiresAt>Date.now()){$('#queryPhone').value=legacy.phone;$('#forgetQuery').hidden=false;}}catch{}
function clearResult(){results=[];resultIdentity=null;$('#openPassError').textContent='';$('#queryResult').hidden=true;$('#resultCode').textContent='';$('#resultCodeWrap').hidden=true;$('#resultSelect').replaceChildren();}
for(const id of ['queryHostName','queryVisitorName','queryPhone','queryDate'])$('#'+id).addEventListener('input',()=>{revision++;clearResult();});
$('#forgetQuery').onclick=()=>{revision++;forgetIdentity();$('#queryPhone').value='';$('#queryHostName').value='';$('#queryVisitorName').value='';$('#queryDate').value='';clearResult();$('#queryError').textContent='已清除本机保存的查询信息';};
function showResult(index){const out=results[index];if(!out)return;$('#openPassError').textContent='';$('#queryResult').hidden=false;$('#queryStatus').textContent=out.statusText;$('#resultNo').textContent=out.sp_no;$('#resultDate').textContent=out.date;$('#resultTime').textContent=out.start+' — '+out.end;$('#resultNote').textContent=out.note;$('#resultCodeWrap').hidden=!out.verifyCode;$('#resultCode').textContent=out.verifyCode||'';}
$('#resultSelect').onchange=()=>showResult(Number($('#resultSelect').value));
async function queryResult(){if(busy||!csrf||!$('#queryForm').reportValidity())return;busy=true;const current=revision,identity={visitorName:$('#queryVisitorName').value.trim(),hostName:$('#queryHostName').value.trim(),phone:$('#queryPhone').value.trim(),date:$('#queryDate').value};clearResult();$('#queryError').textContent='';$('#queryButton').disabled=true;
 try{const r=await fetch('/api/approval/query',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(identity)});const out=await r.json();if(current!==revision)return;if(!r.ok)throw Error(out.error);if(!Array.isArray(out.results)||!out.results.length)throw Error('暂无匹配申请');rememberIdentity(identity);results=out.results;resultIdentity=identity;
  results.forEach((record,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=record.start+'—'+record.end+' · '+record.statusText+' · '+record.sp_no;$('#resultSelect').append(option);});$('#resultPicker').hidden=results.length<2;$('#querySummary').textContent=`找到 ${results.length} 条匹配申请`+(out.partial?'，部分申请暂未能读取，请稍后刷新。':'。');const selected=Math.max(0,results.findIndex(record=>record.sp_no===preferred));$('#resultSelect').value=String(selected);showResult(selected);$('#queryResult').scrollIntoView({behavior:'smooth',block:'nearest'});
 }catch(e){if(current===revision)$('#queryError').textContent=e.message||'查询失败，请稍后再试';}finally{busy=false;$('#queryButton').disabled=false;}}
$('#queryForm').onsubmit=event=>{event.preventDefault();queryResult();};
fetch('/api/gate/config').then(async r=>{const out=await r.json();if(!r.ok)throw Error(out.error);csrf=out.csrf;$('#queryButton').disabled=false;if(saved)await queryResult();}).catch(e=>$('#queryError').textContent=e.message||'请刷新页面');

$('#openPass').onclick=async()=>{
 if(busy||!csrf||!resultIdentity)return;
 const selected=Number($('#resultSelect').value),record=results[selected],current=revision;
 if(!record?.verifyCode)return;
 busy=true;$('#openPass').disabled=true;$('#queryButton').disabled=true;$('#resultSelect').disabled=true;$('#openPassError').textContent='';$('#openPass').textContent='正在核验…';
 try{
  const r=await fetch('/api/gate/verify',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({phone:resultIdentity.phone,code:record.verifyCode})});
  const card=await r.json();if(!r.ok)throw Error(card.error||'核验失败，请重新查询');
  if(current!==revision)return;
  if(card.sp_no!==record.sp_no)throw Error('核验申请不匹配，请重新查询');
  location.assign('/verify#card');
 }catch(e){if(current===revision)$('#openPassError').textContent=e.message||'核验失败，请稍后重试';}
 finally{busy=false;$('#openPass').disabled=false;$('#queryButton').disabled=false;$('#resultSelect').disabled=false;$('#openPass').textContent='打开临时入校卡';}
};
