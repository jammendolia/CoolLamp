#pragma once
#include <stdint.h>
#include <stddef.h>

// Loop-owned authority for the dedicated household HTTP adapter. It does not
// relax native BLE admission or export a lamp/fleet password. Phone invitation
// sharing requires an authenticated confidential native channel.
namespace LampHousehold {
constexpr uint8_t Version=1,Capacity=8;
constexpr size_t PhoneBytes=8,KeyBytes=16,ProofBytes=32,BodyLimit=1024;
constexpr uint32_t InvitationLifetime=120000;
enum class Result:uint8_t {Persisted,Accepted,Duplicate,Rejected,Conflict,CapacityFull,Expired,StorageFailure,Uncertain};
struct Status {bool available=false;uint8_t active=0,pending=0,revoked=0;uint32_t revision=0;uint64_t boot=0;uint8_t target[6]{};};
struct Invitation {uint8_t phone[PhoneBytes]{},secret[KeyBytes]{},target[6]{};uint32_t epoch=0,expiresAt=0;uint64_t boot=0,requestId=0;};
struct Challenge {uint8_t phone[PhoneBytes]{},nonce[16]{},target[6]{};uint32_t epoch=0;uint64_t boot=0;};
struct Authorization {uint8_t phone[PhoneBytes]{},proof[ProofBytes]{};uint32_t epoch=0,sequence=0;uint64_t boot=0,requestId=0;uint8_t endpoint=0,method=0;};
void begin();
Status status();
// Existing authenticated administrator only. Private invitation output must be
// transferred through an authenticated confidential phone-sharing channel and
// written to the native credential vault, never ordinary app storage/logs.
Result invite(const uint8_t* phone,uint64_t requestId,uint32_t expectedRevision,Invitation&);
Result challenge(const uint8_t* phone,Challenge&);
// Proof covers target/session/phone/epoch/challenge/original invite request.
Result adopt(const uint8_t* phone,uint64_t requestId,const uint8_t* proof);
Result revoke(const uint8_t* phone,uint64_t requestId,uint32_t expectedRevision);
// Authorization is separate from target execution receipts. Duplicate never
// permits handler execution; query its command receipt or fresh state.
Result authorize(const Authorization&,const uint8_t* body,size_t size);
// Client/dev-fixture helper; these routines use the same production framing.
bool adoptionProof(const uint8_t* secret,const Challenge&,uint64_t invitationRequest,uint8_t* proof);
bool commandProof(const uint8_t* secret,const Challenge&,const Authorization&,const uint8_t* body,size_t size,uint8_t* proof);
// Signed reply authenticates the target's result over plain local HTTP.
bool responseProof(const uint8_t* secret,const Challenge&,const Authorization&,uint16_t status,const uint8_t* body,size_t size,uint8_t* proof);
bool signResponse(const Authorization&,uint16_t status,const uint8_t* body,size_t size,uint8_t* proof);
void erase(void*,size_t);
}
