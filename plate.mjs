export function normalizePlate(value){
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string')throw Error('请填写有效的车牌号码');
 if(value.length>200)throw Error('车牌号过长');
 const plate=value.normalize('NFKC').toUpperCase().replace(/[^\p{Script=Han}A-Z0-9]/gu,'');
 if(!plate&&value.trim())throw Error('请填写有效的车牌号码');
 if(plate.length>20)throw Error('车牌号过长');
 return plate;
}

export const plateProvinces=[...'粤京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘桂琼渝川贵云藏陕甘青宁新'];
export const plateLetters=[...'ABCDEFGHJKLMNPQRSTUVWXYZ'];
export const plateDigits=[...'0123456789'];
export const plateSuffixes=[...'港澳学警领挂'];
export function validPlate(value){
 if(typeof value!=='string')return false;
 const chars=[...value];
 if(![7,8].includes(chars.length)||!plateProvinces.includes(chars[0])||!plateLetters.includes(chars[1]))return false;
 return chars.slice(2).every((c,i)=>plateLetters.includes(c)||plateDigits.includes(c)||(chars.length===7&&i===4&&plateSuffixes.includes(c)));
}
export function validatePlate(value){const plate=normalizePlate(value);if(plate&&!validPlate(plate))throw Error('车牌号码格式不正确，请选择完整的7位普通车牌或8位新能源车牌，不要填写说明文字');return plate;}
export function plateKeys(index,size=7){if(index===0)return plateProvinces;if(index===1)return plateLetters;return [...plateDigits,...plateLetters,...(size===7&&index===6?plateSuffixes:[])];}
