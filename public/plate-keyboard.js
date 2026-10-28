import {plateKeys,normalizePlate,validPlate} from '/plate-rules.mjs';
const $=id=>document.getElementById(id),input=$('plate'),dialog=$('plateDialog');let size=7,index=0,draft=[];
function makeButton(text,action){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',action);return b;}
function paint(){
 $('plateSlots').replaceChildren();$('plateSlots').classList.toggle('energy',size===8);
 for(let i=0;i<size;i++){const b=makeButton(draft[i]||'',()=>{index=i;paint();});b.className='plate-slot'+(i===index?' current':'');b.setAttribute('aria-label',`第${i+1}位${draft[i]?'：'+draft[i]:'：待选择'}`);b.setAttribute('aria-pressed',String(i===index));$('plateSlots').append(b);}
 document.querySelectorAll('[data-plate-size]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.plateSize)===size)));
 $('platePosition').textContent=index===0?'第 1 位：选择省份简称':index===1?'第 2 位：选择发牌机关字母（不含 I、O）':`第 ${index+1} 位：选择字母或数字${size===7&&index===6?'，或特殊尾字':''}`;
 $('plateKeys').replaceChildren();for(const key of plateKeys(index,size)){$('plateKeys').append(makeButton(key,()=>enter(key)));}
 $('plateDone').disabled=!complete();$('plateKeyboardError').textContent='';
}
function complete(){return draft.length===size&&draft.every((c,i)=>c&&plateKeys(i,size).includes(c))&&validPlate(draft.join(''));}
function enter(char){if(!plateKeys(index,size).includes(char))return;draft[index]=char;if(index<size-1)index++;paint();$('plateSlots').children[index].focus({preventScroll:true});}
function display(){const v=input.value;$('plateDisplay').textContent=v||'点击选择车牌号码';$('plateDisplay').classList.toggle('has-value',!!v);$('plateOpen').classList.toggle('energy',v.length===8);$('plateOpen').setAttribute('aria-label','入校车牌号码：'+(v||'未填写，点击选择'));}
function save(value){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));display();dialog.close();$('plateOpen').focus();}
$('plateOpen').onclick=()=>{draft=[...input.value];size=draft.length===8?8:7;index=draft.findIndex(c=>!c);if(index<0)index=Math.min(draft.length,size-1);paint();dialog.showModal();$('plateSlots').children[index].focus();};
$('plateClose').onclick=()=>dialog.close();
document.querySelectorAll('[data-plate-size]').forEach(b=>b.onclick=()=>{const next=Number(b.dataset.plateSize);if(next===size)return;size=next;draft=draft.slice(0,size);index=Math.min(index,size-1);if(size===8)for(let i=2;i<draft.length;i++)if(!plateKeys(i,size).includes(draft[i]))draft[i]='';paint();});
$('plateBackspace').onclick=()=>{if(!draft[index]&&index>0)index--;draft[index]='';paint();};
$('plateReset').onclick=()=>{draft=[];index=0;paint();};$('plateNoVehicle').onclick=()=>save('');
$('plateDone').onclick=()=>{if(!complete()){$('plateKeyboardError').textContent='请完整选择每一位车牌号码';return;}save(normalizePlate(draft.join('')));};
dialog.addEventListener('keydown',event=>{if(event.altKey||event.ctrlKey||event.metaKey)return;const char=event.key.toUpperCase();if(event.key==='Backspace'){event.preventDefault();$('plateBackspace').click();}else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();index=Math.max(0,Math.min(size-1,index+(event.key==='ArrowLeft'?-1:1)));paint();$('plateSlots').children[index].focus();}else if(plateKeys(index,size).includes(char)){event.preventDefault();enter(char);}});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});display();
