#pragma once
#include "../LampFirmwareRelay.h"
#include "../LampMeshAdapter.h"
#include "../LampCommission.h"
inline bool fixtureRolloutPins=false;
inline bool lampRolloutPinsMembership(){return fixtureRolloutPins;}
namespace LampFirmwareRelay {
inline bool ownsRadio(){return false;}
inline bool receive(const LampEspNow::Received&){return false;}
inline void service(uint32_t){}
inline void suspend(){}
}
// These legacy group tests isolate UDP/ESP-NOW coordination. Production mesh
// and commissioning execution/crypto are tested by their own runtime suites.
inline void (*fixtureMeshServiceHook)(uint32_t)=nullptr;
inline uint32_t fixtureMeshServiceAt=0,fixtureCommissionServiceAt=0;
namespace LampMeshAdapter {
inline bool enabled(){return false;}
inline bool receive(const LampEspNow::Received&){return false;}
inline void service(uint32_t now,bool){fixtureMeshServiceAt=now;if(fixtureMeshServiceHook)fixtureMeshServiceHook(now);}
}
namespace LampCommission {
inline bool receive(const LampEspNow::Received&){return false;}
inline void service(uint32_t now,bool){fixtureCommissionServiceAt=now;}
inline bool working(){return false;}
}
