#pragma once
#include <stdint.h>
#include <stddef.h>
namespace LampCommissionCrypto {
constexpr size_t PublicKeySize=65,HeaderSize=48,TagSize=16,BodyLimit=32;
enum Kind:uint8_t {Ready=1,Approved=2,Commit=3,Finish=4,Failed=5,Cancel=6};
struct Transcript {
 uint8_t broker[6]{},target[6]{},brokerPublic[PublicKeySize]{},targetPublic[PublicKeySize]{},fleetId[8]{};
 uint8_t brokerNonce[16]{},targetNonce[16]{},brokerCommit[32]{},targetCommit[32]{};
 uint64_t brokerBoot=0,targetBoot=0,requestId=0;
};
struct Keys {uint8_t brokerToTarget[16]{},targetToBroker[16]{},digest[32]{},pattern[4]{};};
class Exchange {
 public:
 Exchange()=default;~Exchange();Exchange(const Exchange&)=delete;Exchange& operator=(const Exchange&)=delete;
 bool generate();
 bool derive(const uint8_t* peerPublic,const Transcript&,Keys&);
 void clear();bool active()const{return context_!=nullptr;}
 const uint8_t* publicKey()const{return public_;}
 private:void* context_=nullptr;uint8_t public_[PublicKeySize]{};
};
void erase(void*,size_t);
bool fleetIdentifier(const uint8_t* fleet,uint8_t* id);
// Public-key commitments hide the DH points until BOTH parties have fixed
// their choices. The random nonce also prevents precomputed commitments.
bool commitment(const uint8_t* mac,uint64_t boot,const uint8_t* publicKey,const uint8_t* nonce,uint8_t* output);
// Direction0 is broker->target, direction1 is target->broker. Every send reserves
// a sequence exactly once; retransmission reuses the sealed packet verbatim.
bool seal(const Transcript&,const Keys&,uint8_t direction,uint8_t kind,uint32_t sequence,const uint8_t* body,size_t bodySize,uint8_t* output,size_t& size);
bool open(const Transcript&,const Keys&,const uint8_t* physicalSource,const uint8_t* input,size_t size,uint8_t& kind,uint32_t& sequence,uint8_t* body,size_t& bodySize);
}
