// Included by the runner after extraction of actual BridgeRuntime helpers.
// The generated prefix supplies only SDK/storage/task mocks, not bench logic.
std::vector<uint8_t> candidate;
void prepareBench(unsigned bank=0){
 reset();bench=BridgeBench::Session{};server.activeClients=false;
 BridgeLampLinks::valid=true;BridgeControl::policyAllowed=true;LampEspNow::radio={};
 config.trusted=1;config.offerUpdates=1;config.ownerPasswordSet=1;
 cacheRecord=record(bank,3);
 preferences["bridgecache:recordV1"]={reinterpret_cast<const uint8_t*>(&cacheRecord),reinterpret_cast<const uint8_t*>(&cacheRecord)+sizeof(cacheRecord)};
 loadCache();settle();assert(cacheDurable&&artifact.ready()&&artifact.metadata().image.version[2]==3);
 assert(preferenceWrites==0);
 const auto candidateAt=CacheDataOffset+(1-bank)*CacheBankSpan;
 std::copy(candidate.begin(),candidate.end(),flash.begin()+candidateAt);
}
void preservesPublicBank(){
 for(unsigned bank=0;bank<2;++bank)for(unsigned outcome=0;outcome<5;++outcome){
  prepareBench(bank);const auto saved=preferences;const auto bytes=flash;
  const auto savedRecord=cacheRecord;const unsigned writes=preferenceWrites;
  assert(benchResourcesReady());const auto before=benchStatus();
  assert(before.find("\"seedAllowed\":true")!=std::string::npos);
  assert(before.find("\"seedBank\":"+std::to_string(1-bank))!=std::string::npos);
  assert(before.find("\"seedFlashOffset\":"+std::to_string(partition.address+CacheDataOffset+(1-bank)*CacheBankSpan))!=std::string::npos);
  if(outcome==4)flash[CacheDataOffset+(1-bank)*CacheBankSpan+25000]^=1;
  const auto flashAfterSeeding=flash;
  assert(armBench(fakeNow)&&!cacheDurable&&cacheCommitted);
  assert(!armBench(fakeNow)&&!startCache());
  if(outcome==4){settle();assert(!bench.active());}
  else{
   settle();assert(bench.donating()&&artifact.metadata().trust==BridgeArtifact::Trust::LocalPhysicalBench&&!cacheDurable);
   assert(benchStatus().find("\"durable\":false")!=std::string::npos);
   // Physical bench writes no cache record: the original bank remains authoritative.
   assert(cacheRecord.reserved==bank&&!memcmp(&cacheRecord,&savedRecord,sizeof(cacheRecord)));
   if(outcome==0)++donor.evidence.completed;
   else if(outcome==1)++donor.evidence.failed;
   else if(outcome==2)fakeNow+=BridgeBenchFixture::LifetimeMs;
   else {
    // A source pinned by an active sender must be released before restoring it.
    assert(artifact.acquire());donor.active=true;fakeNow+=BridgeBenchFixture::LifetimeMs;
   }
   serviceCache(fakeNow);settle();
  }
  assert(!bench.active()&&bench.used()&&!armBench(fakeNow));
  assert(cacheCommitted&&cacheDurable&&artifact.ready()&&!artifact.pinned());
  assert(artifact.metadata().trust==BridgeArtifact::Trust::HttpsPinnedLegacy&&artifact.metadata().image.version[2]==3);
  assert(preferences==saved&&preferenceWrites==writes&&!memcmp(&cacheRecord,&savedRecord,sizeof(cacheRecord)));
  assert(flash==flashAfterSeeding); // No production helper writes either bank.
  const auto result=benchStatus();assert(result.find(outcome==0?"\"phase\":\"complete\"":outcome==2||outcome==3?"\"phase\":\"expired\"":"\"phase\":\"failed\"")!=std::string::npos);
  const size_t originalAt=CacheDataOffset+bank*CacheBankSpan;
  assert(std::equal(bytes.begin()+originalAt,bytes.begin()+originalAt+CacheBankSpan,flash.begin()+originalAt));
 }
}
void resourceGuards(){
 for(unsigned guard=0;guard<23;++guard){
  prepareBench();const auto saved=preferences;const unsigned writes=preferenceWrites;
  switch(guard){
  case 0:cacheCommitted=false;break;
  case 1:cacheDurable=false;break;
  case 2:cacheRecord.reserved=2;break;
  case 3:cachePartition=nullptr;break;
  case 4:job=Checking;break;
  case 5:assert(artifact.clear());break;
  case 6:assert(artifact.acquire());break;
  case 7:downloadTask=reinterpret_cast<void*>(1);break;
  case 8:cacheWriteUncertain=true;break;
  case 9:configStorageFault=true;break;
  case 10:configWriteUncertain=true;break;
  case 11:BridgeLampLinks::valid=false;break;
  case 12:config.ownerPasswordSet=0;break;
  case 13:config.trusted=0;break;
  case 14:config.offerUpdates=0;break;
  case 15:secureApPending=true;break;
  case 16:wifiPending=true;break;
  case 17:BridgeWifiScan::scanningFlag=true;break;
  case 18:LampCommission::workingFlag=true;break;
  case 19:donor.active=true;break;
  case 20:BridgeControl::policyAllowed=false;break;
  case 21:server.activeClients=true;break;
  case 22:LampEspNow::radio.suspended=true;break;
  }
  assert(!benchResourcesReady()&&!armBench(fakeNow)&&!bench.used());
  assert(preferences==saved&&preferenceWrites==writes);
 }
 prepareBench();LampEspNow::radio.active=false;assert(!armBench(fakeNow));
 prepareBench();partition.size=CacheDataOffset+CacheBankSpan+100;assert(!armBench(fakeNow));
 prepareBench();cacheRecord.original[5]^=1;assert(!armBench(fakeNow));
 prepareBench();cacheRecord.length--;assert(!armBench(fakeNow));
 prepareBench();cacheRecord=record(0,4);assert(beginArtifact(cacheRecord));settle();assert(!armBench(fakeNow));
}
void interruptedAndRestoreFailure(){
 prepareBench();const auto saved=preferences;assert(armBench(fakeNow));settle();
 assert(bench.donating()&&!cacheDurable);
 // A reboot reconstructs the actual committed record; it never revives bench state.
 donor.cancel();assert(artifact.clear());bench=BridgeBench::Session{};
 cacheCommitted=cacheDurable=false;cacheRecord={};workerRecord={};job=Idle;
 loadCache();settle();serviceCache(fakeNow);
 assert(cacheDurable&&artifact.metadata().image.version[2]==3&&!bench.active()&&!bench.used());
 assert(preferences==saved&&preferenceWrites==0);
 prepareBench();assert(armBench(fakeNow));settle();
 flash[CacheDataOffset+1000]^=1;donor.evidence.completed++;
 serviceCache(fakeNow);settle();
 assert(!bench.active()&&!cacheDurable&&cacheCommitted&&job==Failed);
 assert(!armBench(fakeNow)&&preferenceWrites==0);
 assert(benchStatus().find("\"phase\":\"failed\"")!=std::string::npos);
}
void frozenSeedWindow(){
 for(unsigned bank=0;bank<2;++bank){
  prepareBench(bank);const auto saved=preferences;const auto bytes=flash;const auto committedRecord=cacheRecord;
  const auto before=benchStatus();assert(before.find("\"cacheHeldForBench\":true")!=std::string::npos);
  // Automatic and manual checks use this same production admission. Neither
  // may flip the committed bank while the physical seed offset is in use.
  for(unsigned attempt=0;attempt<16;++attempt){
   fakeNow+=15000;assert(!startCache());serviceCache(fakeNow);
   assert(!downloadTask&&job==Ready&&cacheDurable&&!bench.used());
   assert(benchStatus()==before&&nextCacheBank()==1-bank);
   assert(preferences==saved&&preferenceWrites==0&&flash==bytes);
  }
  assert(armBench(fakeNow));settle();assert(!startCache()&&!downloadTask);
  ++donor.evidence.completed;serviceCache(fakeNow);settle();
  assert(benchStatus().find("\"cacheHeldForBench\":false")!=std::string::npos);
  assert(startCache()&&downloadTask&&job==Checking); // Normal checks resume after restoration.
  finishWorker(true,committedRecord);assert(cacheDurable&&job==Ready&&!downloadTask);
  assert(preferences==saved&&preferenceWrites==0&&flash==bytes);
  // Boot reconstruction freezes the public bank again; no prior arm revives.
  donor.cancel();assert(artifact.clear());bench=BridgeBench::Session{};
  cacheCommitted=cacheDurable=false;cacheRecord={};workerRecord={};job=Idle;
  loadCache();settle();assert(!startCache()&&!downloadTask&&!bench.active()&&!bench.used());
  assert(benchStatus().find("\"cacheHeldForBench\":true")!=std::string::npos);
  assert(preferences==saved&&preferenceWrites==0&&flash==bytes);
 }
}
void freshArmClock(){
 prepareBench();const auto saved=preferences;const uint32_t captured=fakeNow;
 ++fakeNow;assert(armBench(fakeNow));
 // The production loop captured its timestamp before USB parsed bench-arm.
 // serviceCache must obtain a current sample for the newly created lease.
 serviceCache(captured);assert(bench.running()&&!bench.needsRestore());
 assert(!cacheDurable&&preferences==saved&&preferenceWrites==0);
 settle();assert(bench.donating());
 prepareBench();fakeNow=UINT32_MAX;assert(armBench(fakeNow));
 fakeNow=0;serviceCache(UINT32_MAX-1);assert(bench.running()&&!bench.needsRestore());
 settle();assert(bench.donating());
}
void currentDonorDispatchClock(){
 prepareBench();fakeNow=100000;const uint32_t captured=fakeNow;
 serialClockAdvance=true;BridgeControl::advance=true;LampEspNow::pendingPackets=1;
 productionBridgeService();
 assert(donor.receiveCalls==1&&donor.receiveNow==captured+2);
 assert(donor.serviceCalls==1&&donor.serviceNow==captured+3);
 assert(preferenceWrites==0&&!downloadTask);
 serialClockAdvance=BridgeControl::advance=false;
}
int main(int argc,char** argv){
 assert(argc==2);std::ifstream stream(argv[1],std::ios::binary);assert(stream);
 candidate={std::istreambuf_iterator<char>(stream),std::istreambuf_iterator<char>()};
 preservesPublicBank();resourceGuards();interruptedAndRestoreFailure();frozenSeedWindow();freshArmClock();currentDonorDispatchClock();
 std::cout<<"PASS actual bench Runtime arm/cache/restore helpers: both inactive banks, guarded ownership, pinned cancellation, completion/failure/expiry/reboot and unchanged committed records with zero NVS writes\n";
}
