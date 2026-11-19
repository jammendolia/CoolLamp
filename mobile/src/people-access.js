const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const OPAQUE_ID=/^(?!0{32}$)[a-f0-9]{32}$/;
const DEVICE_ID=/^(?!0{12}$)[a-f0-9]{12}$/;
const TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PAGE_STATES=new Set(['checking','not-configured','unavailable','ready','revoked','failed','uncertain','recovery-required','owner-help-required']);
const ROLES=new Set(['owner','admin','member','guest']);
const MEMBER_STATES=new Set(['active','revoked']);
const PHONE_STATES=new Set(['active','revoked']);
const INVITATION_STATES=new Set(['issued','accepting','accepted','cancelled','expired']);
const ACTIVITY_KINDS=new Set(['issue-invitation','accept-invitation','revoke-installation','revoke-membership']);
const ACTIVITY_PHASES=new Set(['sending','checking','confirmed','failed','uncertain']);
const TARGET_OUTCOMES=new Set(['applied','pending','unavailable','rejected','uncertain']);
const ROLE_LABELS=Object.freeze({owner:'Owner',admin:'Administrator',member:'Member',guest:'Guest'});
const encoder=new TextEncoder();

export const PEOPLE_ACCESS_STATES=Object.freeze([...PAGE_STATES]);

function invalid(message='People and access information was incomplete.'){
 const error=Error(message);error.code='people-access-invalid';return error;
}

function plain(value,label){
 const prototype=object(value)?Object.getPrototypeOf(value):undefined;
 if(!object(value)||prototype!==null&&Object.getPrototypeOf(prototype)!==null)throw invalid(label+' must be an object.');
 for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))if(descriptor.get||descriptor.set)throw invalid(label+' cannot contain accessors.');
 return value;
}

function exact(value,keys,label){
 plain(value,label);const allowed=new Set(keys);
 for(const key of Object.keys(value))if(!allowed.has(key))throw invalid(label+' contains an unsupported field.');
 for(const key of keys)if(!Object.hasOwn(value,key))throw invalid(label+' is missing '+key+'.');
 return value;
}

function list(value,max,label){
 if(!Array.isArray(value)||value.length>max)throw invalid(label+' is not a bounded list.');
 for(let index=0;index<value.length;index++)if(!Object.hasOwn(value,index))throw invalid(label+' cannot be sparse.');
 return value;
}

function oneOf(value,values,label){if(!values.has(value))throw invalid(label+' is not supported.');return value;}
function bool(value,label){if(typeof value!=='boolean')throw invalid(label+' must be true or false.');return value;}
function id(value,label,pattern=OPAQUE_ID){if(typeof value!=='string'||!pattern.test(value))throw invalid(label+' is invalid.');return value;}
function name(value,label){if(typeof value!=='string'||!value.trim()||encoder.encode(value).length>64)throw invalid(label+' is invalid.');return value;}
function nullableName(value,label){return value===null?null:name(value,label);}
function nullableTimestamp(value,label){
 if(value===null)return null;
 if(typeof value!=='string'||!TIMESTAMP.test(value)||!Number.isFinite(Date.parse(value)))throw invalid(label+' is invalid.');
 return value;
}

function unique(rows,label){
 const seen=new Set();for(const row of rows){if(seen.has(row.id))throw invalid(label+' contains a duplicate ID.');seen.add(row.id);}return rows;
}

function freeze(value){
 if(!object(value)&&!Array.isArray(value))return value;
 for(const entry of Object.values(value))freeze(entry);
 return Object.freeze(value);
}

function scope(value,label){
 exact(value,['kind','targetNames'],label);
 if(!['home','targets'].includes(value.kind))throw invalid(label+' kind is not supported.');
 const targetNames=list(value.targetNames,64,label+' targets').map((entry,index)=>name(entry,label+' target '+index));
 if(value.kind==='home'&&targetNames.length)throw invalid(label+' cannot name targets for the whole Home.');
 if(value.kind==='targets'&&!targetNames.length)throw invalid(label+' must name at least one target.');
 return {kind:value.kind,targetNames};
}

function home(value){exact(value,['id','name'], 'Home');return {id:value.id===null?null:id(value.id,'Home ID'),name:name(value.name,'Home name')};}

function viewer(value){
 if(value===null)return null;
 exact(value,['personId','installationId','canManagePeople'],'Current phone');
 return {personId:id(value.personId,'Current person ID'),installationId:id(value.installationId,'Current phone ID'),canManagePeople:bool(value.canManagePeople,'People permission')};
}

function phone(value,index){
 exact(value,['id','name','status'],`Phone ${index}`);
 return {id:id(value.id,`Phone ${index} ID`),name:name(value.name,`Phone ${index} name`),status:oneOf(value.status,PHONE_STATES,`Phone ${index} status`)};
}

function person(value,index){
 exact(value,['id','name','role','status','expiresAt','scope','phones'],`Person ${index}`);
 const role=oneOf(value.role,ROLES,`Person ${index} role`),expiresAt=nullableTimestamp(value.expiresAt,`Person ${index} expiry`),accessScope=scope(value.scope,`Person ${index} scope`);
 if(role==='guest'&&expiresAt===null)throw invalid('Guest access must expire.');
 if(role==='guest'&&accessScope.kind!=='targets')throw invalid('Guest access must name its lights.');
 return {id:id(value.id,`Person ${index} ID`),name:name(value.name,`Person ${index} name`),role,status:oneOf(value.status,MEMBER_STATES,`Person ${index} status`),expiresAt,scope:accessScope,phones:unique(list(value.phones,16,`Person ${index} phones`).map(phone),`Person ${index} phones`)};
}

function invitation(value,index){
 exact(value,['id','recipientName','role','state','expiresAt','accessExpiresAt','scope'],`Invitation ${index}`);
 const role=oneOf(value.role,ROLES,`Invitation ${index} role`),state=oneOf(value.state,INVITATION_STATES,`Invitation ${index} state`),expiresAt=nullableTimestamp(value.expiresAt,`Invitation ${index} expiry`),accessExpiresAt=nullableTimestamp(value.accessExpiresAt,`Invitation ${index} access expiry`),accessScope=scope(value.scope,`Invitation ${index} scope`);
 if(role==='owner')throw invalid('An invitation cannot transfer Home ownership.');
 if(expiresAt===null)throw invalid('An invitation must expire.');
 if(role==='guest'&&(accessExpiresAt===null||accessScope.kind!=='targets'))throw invalid('Guest invitations must be temporary and name their lights.');
 return {id:id(value.id,`Invitation ${index} ID`),recipientName:name(value.recipientName,`Invitation ${index} recipient`),role,state,expiresAt,accessExpiresAt,scope:accessScope};
}

function target(value,index){
 exact(value,['id','name','outcome'],`Changed product ${index}`);
 return {id:id(value.id,`Changed product ${index} ID`,DEVICE_ID),name:name(value.name,`Changed product ${index} name`),outcome:oneOf(value.outcome,TARGET_OUTCOMES,`Changed product ${index} outcome`)};
}

function activity(value){
 if(value===null)return null;
 exact(value,['kind','phase','personName','phoneName','targets'],'Current change');
 const kind=oneOf(value.kind,ACTIVITY_KINDS,'Current change kind'),phoneName=nullableName(value.phoneName,'Changed phone name');
 if(kind==='revoke-installation'&&phoneName===null)throw invalid('Removing one phone requires its name.');
 if(kind!=='revoke-installation'&&phoneName!==null)throw invalid('Only a one-phone removal can name a phone.');
 return {kind,phase:oneOf(value.phase,ACTIVITY_PHASES,'Current change phase'),personName:name(value.personName,'Changed person name'),phoneName,targets:unique(list(value.targets,64,'Changed products').map(target),'Changed products')};
}

function dateLabel(value){
 return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value));
}

function targetSummary(names){
 if(names.length===1)return names[0];
 if(names.length===2)return names[0]+' and '+names[1];
 return names[0]+', '+names[1]+', and '+(names.length-2)+' more';
}

function roleSummary(row){
 if(row.status==='revoked')return 'Access removed';
 if(row.role==='owner')return 'Manages this Home and its people';
 if(row.role==='admin')return 'Can manage this Home, except its owner';
 if(row.role==='member')return row.scope.kind==='home'?'Can control lights, Scenes, and schedules':`Can use ${targetSummary(row.scope.targetNames)}`;
 return `Can use ${targetSummary(row.scope.targetNames)} until ${dateLabel(row.expiresAt)}`;
}

function phoneRow(row,personRow,current,homeName,allowChanges){
 const isCurrent=row.id===current?.installationId,active=row.status==='active';
 return {
  id:row.id,name:row.name,status:active?'Active':'Removed',isCurrent,
  detail:isCurrent?'This phone':active?'Can use '+homeName:'No longer has access',
  action:allowChanges&&active&&!isCurrent?{id:'remove-phone',label:'Remove this phone',accessibleLabel:`Remove ${row.name} from ${homeName}`,personId:personRow.id,installationId:row.id}:null
 };
}

function personRow(row,current,homeName,allowChanges){
 const isCurrent=row.id===current?.personId,active=row.status==='active';
 const phones=row.phones.map(value=>phoneRow(value,row,current,homeName,allowChanges));
 return {
  id:row.id,name:row.name,role:row.role,roleLabel:ROLE_LABELS[row.role],status:active?'Active':'Removed',isCurrent,
  summary:roleSummary(row),expiresAt:row.expiresAt,scope:{kind:row.scope.kind,targetNames:[...row.scope.targetNames]},phones,
  action:{id:'open-person',label:'View details',accessibleLabel:`View ${row.name}'s access to ${homeName}`,personId:row.id},
  removeAction:allowChanges&&active&&!isCurrent&&row.role!=='owner'?{id:'remove-person',label:`Remove ${row.name}'s access`,accessibleLabel:`Remove ${row.name}'s access to ${homeName}`,personId:row.id}:null
 };
}

function invitationRow(row,homeName,allowChanges){
 let status='Invitation sent',detail=`${ROLE_LABELS[row.role]} access to ${homeName} · Expires ${dateLabel(row.expiresAt)}`,action={id:'cancel-invitation',label:'Cancel invitation',accessibleLabel:`Cancel ${row.recipientName}'s invitation to ${homeName}`,invitationId:row.id};
 if(row.state==='accepting'){status='Joining '+homeName+'…';detail=`Checking ${row.recipientName}'s access`;action={id:'check-invitation',label:'Check progress',accessibleLabel:`Check ${row.recipientName}'s invitation to ${homeName}`,invitationId:row.id};}
 else if(row.state==='accepted'){status='Accepted';detail=`${row.recipientName} joined ${homeName}`;action=null;}
 else if(row.state==='cancelled'){status='Cancelled';detail='This invitation can no longer be used';action={id:'invite-again',label:'Invite again',accessibleLabel:`Invite ${row.recipientName} to ${homeName} again`,invitationId:row.id};}
 else if(row.state==='expired'){status='Expired';detail='This invitation can no longer be used';action={id:'invite-again',label:'Invite again',accessibleLabel:`Invite ${row.recipientName} to ${homeName} again`,invitationId:row.id};}
 return {id:row.id,recipientName:row.recipientName,role:row.role,roleLabel:ROLE_LABELS[row.role],state:row.state,status,detail,expiresAt:row.expiresAt,accessExpiresAt:row.accessExpiresAt,scope:{kind:row.scope.kind,targetNames:[...row.scope.targetNames]},action:allowChanges?action:null};
}

function followUp(row){
 if(row.outcome==='applied')return null;
 if(row.outcome==='pending'||row.outcome==='unavailable')return {id:row.id,name:row.name,state:'waiting',message:`${row.name} still needs the access update. Keep it powered on, then check again.`,action:{id:'check-again',label:'Check again',deviceId:row.id}};
 if(row.outcome==='rejected')return {id:row.id,name:row.name,state:'needs-help',message:`${row.name} did not accept the access update. Open Lights & devices to check its power and connection.`,action:{id:'open-devices',label:'Open Lights & devices',deviceId:row.id}};
 return {id:row.id,name:row.name,state:'uncertain',message:`${row.name} may still need the access update. Check again before trying the change again.`,action:{id:'check-again',label:'Check again',deviceId:row.id}};
}

function activityNotice(change,homeName){
 if(!change)return null;
 const followUps=change.targets.map(followUp).filter(Boolean),pending=followUps.length;
 let title='',detail='',action=null,busy=false,kind='quiet';
 if(change.phase==='sending'){
  busy=true;kind='checking';
  title=change.kind==='issue-invitation'?'Sending invitation…':change.kind==='accept-invitation'?`Joining ${homeName}…`:change.kind==='revoke-installation'?'Removing this phone…':`Removing ${change.personName}'s access…`;
  detail='This can take a moment.';
 }else if(change.phase==='checking'){
  busy=true;kind='checking';title='Checking the saved access…';detail=`We’re checking ${homeName} before showing the result.`;
 }else if(change.phase==='uncertain'){
  kind='problem';title=change.kind==='issue-invitation'?'The invitation may have been sent.':change.kind==='accept-invitation'?`${change.personName}'s phone may have joined ${homeName}.`:change.kind==='revoke-installation'?`${change.phoneName} may have been removed.`:`${change.personName}'s access may have changed.`;
  detail=`We’re checking ${homeName} before trying anything again.`;action={id:'check-again',label:'Check again'};
 }else if(change.phase==='failed'){
  kind='problem';title=change.kind==='issue-invitation'?'The invitation was not sent.':change.kind==='accept-invitation'?`${change.personName} has not joined ${homeName}.`:change.kind==='revoke-installation'?`${change.phoneName} still has access.`:`${change.personName} still has access.`;
  detail='Check your connection and try again.';action={id:'retry',label:'Try again'};
 }else{
  kind=pending?'attention':'success';
  title=change.kind==='issue-invitation'?'Invitation sent.':change.kind==='accept-invitation'?`${change.personName} joined ${homeName}.`:change.kind==='revoke-installation'?`${change.phoneName} was removed.`:`${change.personName}'s access was removed.`;
  detail=pending?`${pending} ${pending===1?'light still needs':'lights still need'} this change.`:'The change is complete.';
  if(pending)action={id:'check-again',label:'Check again'};
 }
 return {kind,title,detail,busy,action,followUps};
}

function pageNotice(state,homeName,change,pendingTargets){
 const activity=activityNotice(change,homeName);if(activity)return activity;
 const followUps=pendingTargets.map(followUp).filter(Boolean);
 if(state==='checking')return {kind:'checking',title:'Checking people and access…',detail:`We’re refreshing ${homeName}.`,busy:true,action:null,followUps:[]};
 if(state==='not-configured')return {kind:'quiet',title:'Sharing is not set up yet.',detail:'There is nothing to manage here right now.',busy:false,action:null,followUps:[]};
 if(state==='unavailable')return {kind:'problem',title:'People and access could not be refreshed.',detail:`Keep your Home devices powered on, then try again.`,busy:false,action:{id:'retry',label:'Try again'},followUps};
 if(state==='revoked')return {kind:'problem',title:`This phone no longer has access to ${homeName}.`,detail:'Ask a Home owner to invite you again.',busy:false,action:{id:'request-access',label:'Ask an owner for access'},followUps:[]};
 if(state==='recovery-required')return {kind:'problem',title:'This phone needs to be added again.',detail:'Remove and reinstall CoolLamp, then ask a Home owner to invite this phone again.',busy:false,action:null,followUps:[]};
 if(state==='owner-help-required')return {kind:'problem',title:'This phone’s access needs attention.',detail:'Ask a Home owner to check this phone’s access.',busy:false,action:null,followUps:[]};
 if(state==='failed')return {kind:'problem',title:'People and access could not be checked.',detail:'Unlock your phone, check your connection, and try again.',busy:false,action:{id:'retry',label:'Try again'},followUps:[]};
 if(followUps.length)return {kind:'attention',title:`${followUps.length} ${followUps.length===1?'light still needs':'lights still need'} an access update.`,detail:'Keep the lights powered on, then check again.',busy:false,action:{id:'check-again',label:'Check again'},followUps};
 return null;
}

function validateState(state,viewerValue,people,invitations,pendingTargets,change){
 if(['ready','uncertain'].includes(state)&&viewerValue===null)throw invalid('This state requires a current phone.');
 if(['checking','unavailable','failed'].includes(state)&&viewerValue===null&&(people.length||invitations.length||pendingTargets.length))throw invalid('Unavailable access cannot retain Home details without a current phone.');
 if(['not-configured','revoked','recovery-required','owner-help-required'].includes(state)&&viewerValue!==null)throw invalid('This state cannot retain current-phone access.');
 if(['not-configured','revoked','recovery-required','owner-help-required'].includes(state)&&(people.length||invitations.length||pendingTargets.length))throw invalid('This state cannot retain people, invitations, or pending changes.');
 const expectedPhase={failed:'failed',uncertain:'uncertain'}[state];if(expectedPhase&&change&&change.phase!==expectedPhase)throw invalid('The current change does not match the page state.');
 if(state==='uncertain'&&change===null)throw invalid('Uncertain access requires the change being checked.');
 if(state==='checking'&&change&&!['sending','checking'].includes(change.phase))throw invalid('Checking can only show work in progress.');
 if(state==='ready'&&change&&change.phase!=='confirmed')throw invalid('Ready can only show a confirmed change.');
 if(['not-configured','unavailable','revoked','recovery-required','owner-help-required'].includes(state)&&change!==null)throw invalid('This page state cannot contain a change.');
 if(viewerValue){
  const current=people.find(row=>row.id===viewerValue.personId),phone=current?.phones.find(row=>row.id===viewerValue.installationId);
  if(!current||current.status!=='active'||!phone||phone.status!=='active')throw invalid('The current phone is not active for the current person.');
  if(!viewerValue.canManagePeople&&invitations.length)throw invalid('Invitation details require people-management access.');
 }
}

/**
 * Compiles a credential-free, already validated app-client state into plain
 * presentation data. It deliberately does not escape strings or produce HTML;
 * the renderer owns contextual escaping and accessible markup.
 */
export function compilePeopleAccess(value){
 exact(value,['version','state','home','viewer','people','invitations','pendingTargets','activity'],'People and access');
 if(value.version!==1)throw invalid('People and access version is not supported.');
 const state=oneOf(value.state,PAGE_STATES,'People and access state'),homeValue=home(value.home),viewerValue=viewer(value.viewer),people=unique(list(value.people,64,'People').map(person),'People'),invitations=unique(list(value.invitations,128,'Invitations').map(invitation),'Invitations'),pendingTargets=unique(list(value.pendingTargets,256,'Pending products').map(target),'Pending products'),change=activity(value.activity);
 if(state==='ready'&&homeValue.id===null)throw invalid('Ready access requires a Home ID.');
 validateState(state,viewerValue,people,invitations,pendingTargets,change);
 const canManage=viewerValue?.canManagePeople===true,allowChanges=state==='ready'&&canManage,personRows=people.map(row=>personRow(row,viewerValue,homeValue.name,allowChanges)),invitationRows=invitations.map(row=>invitationRow(row,homeValue.name,allowChanges)),notice=pageNotice(state,homeValue.name,change,pendingTargets);
 const empty=state==='ready'&&!personRows.length&&!invitationRows.length?{title:'No one has access yet.',detail:'Invite someone when you are ready to share this Home.'}:null;
 return freeze({version:1,state,home:{...homeValue},canInvite:state==='ready'&&canManage,inviteAction:state==='ready'&&canManage?{id:'invite-person',label:'Invite someone',accessibleLabel:`Invite someone to ${homeValue.name}`}:null,notice,people:personRows,invitations:invitationRows,empty});
}
