export const HOME_EXPERIENCE_ID='home-v1';

export function homeExperienceEnabled({buildValue,search='',allowQuery=false}={}) {
  if(buildValue==='1'||buildValue===true)return true;
  if(!allowQuery)return false;
  try{return new URLSearchParams(search).get('experience')===HOME_EXPERIENCE_ID;}
  catch{return false;}
}
