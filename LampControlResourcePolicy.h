#pragma once
#ifndef COOLLAMP_CONTROL_RESOURCE_POLICY_H
#define COOLLAMP_CONTROL_RESOURCE_POLICY_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "LampControlEndpoint.h"

// A common admission floor for complete HTTP/BLE/mesh control replies. 24 KiB
// covers the measured 16096-byte moving String peak plus 8 KiB of headroom.
// The initial 6 KiB String reservation requires 6160 contiguous bytes in core
// 3.3.11. This is admission, not a reservation or a bound on SDK allocations.
namespace LampControlResourcePolicy {
constexpr size_t MinFreeHeapBytes=24576,MinLargestBlockBytes=6160;
// A counted read reserves one exact reply, without reallocating the growing
// response. Keep 8 KiB for radio/SDK work and a separate bounded fragment
// allowance; both are checked against CURRENT heap, including retained replies.
constexpr size_t ReadHeadroomBytes=8192,ReadWorkspaceBytes=512;
// Capture leaves are retained before counting a parent reply. Admission must
// cover that independently measured peak, even if the parent is later denied.
constexpr size_t ReadCaptureBytes=2048;
// GET / only authenticates and maps the immutable setup page. It has no
// serializer/capture tree, state mutation or page-sized allocation. Keep the
// existing SDK/workspace allowance plus 3 KiB for a single <=1024-byte TCP
// flight and its SDK overhead; this is admission, not an SDK heap guarantee.
// Raw form staging already exists. Decoded query fields are budgeted separately.
constexpr size_t MappedPageFlightReserveBytes=3072;
constexpr size_t MappedPageSendHeapBytes=ReadHeadroomBytes+ReadWorkspaceBytes+MappedPageFlightReserveBytes;
inline bool mappedPageHttpPath(const char* path,bool post){return !post&&path&&!strcmp(path,"/");}
inline bool mappedPageReady(size_t freeHeap,size_t largestBlock,size_t formBytes){
  if(formBytes>1024)return false;
  const size_t decoded=formBytes?((formBytes+16)&~size_t(15))+24*32:0;
  return freeHeap>=MappedPageSendHeapBytes+decoded&&largestBlock>=ReadWorkspaceBytes;
}
// An authenticated browser preflight only creates one expiring RAM ticket.
// It neither owns flash nor persists settings; its later multipart START has
// separate updater ownership. Keep this policy distinct from side-effect-free
// reads and from ordinary durable mutations.
constexpr size_t UploadPreparationContextBytes=640,UploadPreparationReplyBytes=384;
inline bool preparationHttpPath(const char* path,bool post){
  return post&&path&&!strcmp(path,"/api/firmware/upload/prepare");
}
inline bool preparationReady(size_t freeHeap,size_t largestBlock,size_t formBytes){
  if(formBytes>1024)return false;
  const size_t decoded=formBytes?((formBytes+16)&~size_t(15))+24*32:0;
  const size_t required=ReadHeadroomBytes+ReadWorkspaceBytes+UploadPreparationContextBytes+UploadPreparationReplyBytes+decoded;
  return freeHeap>=required&&largestBlock>=UploadPreparationContextBytes;
}
constexpr size_t ReadDispatchHeapBytes=ReadHeadroomBytes+ReadWorkspaceBytes+ReadCaptureBytes;
inline size_t roundedReplyBytes(size_t bytes){return (bytes+16)&~size_t(15);}
inline bool readReady(size_t freeHeap,size_t largestBlock,size_t formBytes=0,bool copyForm=false){
  // Decoded key/value Strings can coexist with capture leaves. Their total
  // text is bounded by the form, plus two rounded allocations per24 fields.
  // HTTP's raw staging String already exists; BLE also needs its form copy.
  const size_t extra=formBytes?roundedReplyBytes(formBytes)*(copyForm?2:1)+24*32:0;
  const size_t contiguous=copyForm&&formBytes>ReadWorkspaceBytes?roundedReplyBytes(formBytes):ReadWorkspaceBytes;
  return formBytes<=1024&&freeHeap>=ReadDispatchHeapBytes+extra&&largestBlock>=contiguous;
}
inline bool readReplyReady(size_t freeHeap,size_t largestBlock,size_t bytes){
  const size_t allocation=roundedReplyBytes(bytes);
  return bytes&&bytes<=8192&&largestBlock>=allocation&&
    freeHeap>=allocation+ReadHeadroomBytes+ReadWorkspaceBytes;
}
inline bool readEndpoint(uint8_t id,bool mutation){
  using namespace LampControlEndpoint;
  if(mutation)return id==SchemaPage||id==Receipt||id==GroupPage;
  return id==State||id==Sync||id==Audio||id==Firmware||id==Effects||id==Descriptor||id==Revision;
}
inline bool readHttpPath(const char* path,bool post){
  if(!path)return false;
  if(post)return !strcmp(path,"/api/effects/schema")||!strcmp(path,"/api/receipt")||!strcmp(path,"/api/sync/page");
  return !strcmp(path,"/api/state")||!strcmp(path,"/api/firmware")||!strcmp(path,"/api/effects")||
    !strcmp(path,"/api/audio")||
    !strcmp(path,"/api/descriptor")||!strcmp(path,"/api/revision")||!strcmp(path,"/api/diagnostics")||
    !strcmp(path,"/api/firmware/upload/status");
}
inline bool replyReady(size_t freeHeap,size_t largestBlock){
  return freeHeap>=MinFreeHeapBytes&&largestBlock>=MinLargestBlockBytes;
}
}
#endif
