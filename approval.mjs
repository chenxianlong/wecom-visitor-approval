import {validatePlate} from './plate.mjs';
const title=c=>(c.property?.title||[]).find(t=>t.lang==='zh_CN')?.text||c.property?.title?.[0]?.text||'';
const norm=s=>s.replace(/[\s*＊：:]/g,'');
export function validate(d){
 if(!d||typeof d!=='object')throw Error('申请数据无效');
 for(const k of ['visitType','reason','date','start','end'])if(typeof d[k]!=='string'||!d[k].trim())throw Error('请完整填写必填项');
 if(d.reason.length>2000)throw Error('事由不能超过2000字');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.start)||!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(d.end))throw Error('日期或时间格式错误');
 if(!Number.isFinite(+new Date(d.date+'T00:00:00+08:00'))||d.end<=d.start)throw Error('结束时间须晚于开始时间');
 if(d.date<new Date(Date.now()+28800000).toISOString().slice(0,10))throw Error('入校日期不能早于今天');
 if(!Array.isArray(d.visitors)||!d.visitors.length||d.visitors.length>20)throw Error('访客人数应为1至20人');
 for(const v of d.visitors){if(!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>50)throw Error('请填写访客姓名');if(!/^1[3-9]\d{9}$/.test(v.phone))throw Error('请填写有效手机号');if(!validId(v.id))throw Error('请填写有效的18位身份证号码');}
 d.plate=validatePlate(d.plate);
 return d;
}
export function validId(id){if(!/^\d{17}[0-9Xx]$/.test(id))return false;const w=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];return '10X98765432'[w.reduce((s,n,i)=>s+n*Number(id[i]),0)%11]===id[17].toUpperCase();}
export const fields=t=>t.template_content?.controls||[];
export function visitOptions(t){const c=fields(t).find(c=>norm(title(c))==='访问类型');return(c?.config?.selector?.options||[]).map(o=>({key:o.key,label:o.value?.find(v=>v.lang==='zh_CN')?.text||o.value?.[0]?.text||o.key}));}
export function buildPayload(d,t,creator,templateId){
 validate(d);
 const reason=d.reason;
 const values={访问类型:d.visitType,入校事由:reason,入校日期:d.date,开始时间:d.date+'T'+d.start+':00+08:00',结束时间:d.date+'T'+d.end+':00+08:00',入校时间段:String((+new Date(d.date+'T'+d.end+':00+08:00')-new Date(d.date+'T'+d.start+':00+08:00'))/86400000),入校车牌号码:d.plate||'',入校车牌号:d.plate||'',结果通知邮箱:d.notificationEmail||'',通知邮箱:d.notificationEmail||'',电子邮箱:d.notificationEmail||'',邮箱:d.notificationEmail||''};
 function convert(c,row){const p=c.property,n=norm(title(c)),v=row?({姓名:row.name,身份证号码:row.id,身份证号:row.id,手机号码:row.phone,手机号:row.phone}[n]):values[n];
 if(p.control==='Table'){const children=c.config?.table?.children||[];if(!children.length)throw Error('明细表缺少子控件');return {control:p.control,id:p.id,value:{children:d.visitors.map(r=>({list:children.map(ch=>convert(ch,r)).filter(Boolean)}))}};}
 if(['Tips','Formula'].includes(p.control))return null;
 if(v===undefined){if(p.require)throw Error('模板字段“'+title(c)+'”尚未适配');return null;}
 let value;
 if(['Text','Textarea'].includes(p.control))value={text:v};
 else if(p.control==='Number')value={new_number:v};
 else if(p.control==='Selector'){const opt=(c.config?.selector?.options||[]).find(o=>o.key===v);if(!opt)throw Error('访问类型选项无效');value={selector:{type:c.config.selector.type,options:[{key:opt.key}]}};}
 else if(p.control==='DateRange'){
  const type=c.config?.date_range?.type;
  if(!['halfday','hour'].includes(type))throw Error('不支持的时长类型');
  if(type==='halfday'&&(!['00:00','12:00'].includes(d.start)||!['12:00','24:00'].includes(d.end)))throw Error('模板按半天预约，请选择上午或下午');
  const begin=+new Date(d.date+'T'+d.start+':00+08:00')/1000,end=+new Date(d.date+'T'+d.end+':00+08:00')/1000;
  value={date_range:{type,new_begin:begin,new_end:end,new_duration:end-begin}};
 }
 else if(p.control==='Date'){const type=c.config?.date?.type||'day',dt=/^\d{4}-\d{2}-\d{2}$/.test(v)?v+'T00:00:00+08:00':v;value={date:{type,s_timestamp:String(Math.floor(+new Date(dt)/1000))}};}
 else throw Error('控件“'+title(c)+'”（'+p.control+'）需要适配，已阻止提交');
 return {control:p.control,id:p.id,value};}
 const contents=fields(t).map(c=>convert(c)).filter(Boolean);if(!contents.length)throw Error('模板没有可提交字段');
 return {creator_userid:creator,template_id:templateId,use_template_approver:1,apply_data:{contents},summary_list:[{summary_info:[{text:'校外来访 · '+d.visitors.length+'人 · '+d.date,lang:'zh_CN'}]}]};
}
