import packageMetadata from '../package.json' with {type:'json'};

export const APP_VERSION=packageMetadata.version;
export function appVersionLabel(version,build=''){
 const safeBuild=typeof build==='string'&&/^\d+(?:\.\d+)*$/.test(build)?build:'';
 return `CoolLamp ${version}${safeBuild?` (${safeBuild})`:''}`;
}
export const APP_BUILD=import.meta.env?.VITE_COOLLAMP_BUILD||'';
export const APP_VERSION_LABEL=appVersionLabel(APP_VERSION,APP_BUILD);
