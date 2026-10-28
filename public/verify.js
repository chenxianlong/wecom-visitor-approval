const $=s=>document.querySelector(s);let csrf,refreshTimer,clockTimer,serverOffset=0;
function stop(){clearTimeout(refreshTimer);clearInterval(clockTimer);}
function statusIcon(status){const active=status==='active';$('#passAnimation').hidden=!active;$('#statusIcon').hidden=active;$('#statusIcon').textContent=status==='upcoming'?'◷':'!';}
function invalid(message){stop();$('#passBanner').className='pass-banner invalid';statusIcon('invalid');$('#passStatus').textContent='暂不可入校';$('#checkedAt').textContent='未能完成实时核验';$('#passHint').textContent=message;}
function show(card){
 stop();$('#lookup').hidden=true;$('#pass').hidden=false;$('#visitorName').textContent=card.name;$('#visitDate').textContent=card.date;$('#visitTime').textContent=card.start+' — '+card.end+'（北京时间）';$('#approvalNo').textContent=card.sp_no;serverOffset=card.serverTime-Date.now();
 function clock(){const now=Date.now()+serverOffset,status=now>=card.endAt?'expired':now<card.startAt?'upcoming':'active';$('#passBanner').className='pass-banner '+status;statusIcon(status);$('#passStatus').textContent={active:'当前时段有效',upcoming:'未到预约时段',expired:'预约已过期'}[status];$('#checkedAt').textContent=new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});$('#passHint').textContent={active:'审批已通过，请配合门岗核对证件；请勿以截图替代实时核验。',upcoming:'此卡尚未生效，请在预约时段内入校。',expired:'此卡已失效，请勿凭此卡入校。'}[status];}
 clock();clockTimer=setInterval(clock,1000);refreshTimer=setTimeout(refresh,30000);
}
async function refresh(){try{const r=await fetch('/api/gate/card',{cache:'no-store'});const out=await r.json();if(!r.ok)throw Error(out.error);show(out);}catch(e){invalid(e.message||'实时核验失败，请重新核验');}}
$('#gateForm').onsubmit=async event=>{event.preventDefault();$('#verifySubmit').disabled=true;$('#gateError').textContent='';try{const r=await fetch('/api/gate/verify',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({phone:$('#phone').value.trim(),code:$('#code').value.trim()})});const out=await r.json();if(!r.ok)throw Error(out.error);$('#code').value='';show(out);}catch(e){$('#gateError').textContent=e.message||'核验失败，请稍后重试';}finally{$('#verifySubmit').disabled=false;}};
$('#refreshPass').onclick=refresh;$('#resetPass').onclick=()=>{history.replaceState(null,'',location.pathname+location.search);stop();$('#pass').hidden=true;$('#lookup').hidden=false;$('#code').value='';$('#phone').value='';};
const openFromQuery=location.hash==='#card';
if(openFromQuery)$('#lookup').hidden=true;
fetch('/api/gate/config').then(async r=>{
 const c=await r.json();if(!r.ok)throw Error(c.error);csrf=c.csrf;$('#verifySubmit').disabled=false;
 if(openFromQuery){const response=await fetch('/api/gate/card',{cache:'no-store'}),card=await response.json();if(!response.ok)throw Error(card.error||'核验会话已过期，请重新查询或填写核验信息');show(card);}
}).catch(e=>{$('#lookup').hidden=false;$('#gateError').textContent=e.message||'请刷新页面重试';});
