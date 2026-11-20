import packageMetadata from '../package.json' with {type:'json'};

export const APP_VERSION=packageMetadata.version;
export const APP_VERSION_LABEL=`CoolLamp ${APP_VERSION}`;
