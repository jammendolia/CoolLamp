#include "LampUpdate.h"
#include "LampJsonSink.h"
#include "LampWifiSetup.h"
#include "LampFactoryReset.h"
#include "LampAudio.h"
#include "LampUpdateHandoff.h"
#include "LampUpdateHealth.h"
#include "LampUpdateAttempt.h"
#include "LampCommission.h"
#include "LampRollout.h"
#include "LampFirmwareRelay.h"
#include "LampControl.h"
#include "LampConfig.h"
#include "UpdateManifest.h"
#include "UpdatePublisher.h"
#include <WiFi.h>
#include <Preferences.h>
#include <nvs.h>
#include "UpdateHttp.h"
#include "LampUpdateControlPolicy.h"
#include "LampHttpJson.h"
#include <esp_ota_ops.h>
#include <esp_app_format.h>
#include <esp_app_desc.h>
#include <mbedtls/sha256.h>
#include <time.h>
#include <atomic>
#include <stdlib.h>
#include <esp_heap_caps.h>

// Arduino core 3.3.11 normally confirms OTA before setup. Defer until loop is healthy.
extern "C" bool verifyRollbackLater() { return true; }
static LampUpdatePolicy::Eligibility policyEligibility();

namespace {
constexpr char ROOT[] = "https://github.com/jammendolia/CoolLamp/releases/";
constexpr uint16_t CURRENT[3] = {LAMP_VERSION_MAJOR, LAMP_VERSION_MINOR, LAMP_VERSION_PATCH};
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
LampUpdateStatus status{};
FirmwareManifest candidate{};
uint32_t candidateEpoch=0;
char signedCandidate[UpdatePublisher::ManifestCapacity]{};
TaskHandle_t worker = nullptr;
// The loop owns the handle. Completion is published only after the one-shot
// HTTPS operation returns and its TLS objects have been destroyed.
std::atomic<bool> workerFinished{false};
bool manual = false;
uint8_t job = 0;
LampUpdateHandoff handoff;
std::atomic<bool> healthy{false};
LampUpdateHealth bootHealth;
uint32_t nextCheck = 0, restartAt = 0;
char attemptedVersion[24] = {};
LampUpdatePolicy::Policy updatePolicy;
uint32_t policyRevision=1,lastUserUse=0;
bool userUseObserved=false;
bool policyReadable=true;
bool policySaveUncertain=false;
bool policyNeedsReconcile=false;
bool policyReconcileAttempted=false;
uint32_t policyReconcileAttemptAt=0;
bool explicitRepair=false;
bool jobBackground=false;
std::atomic<bool> backgroundActive{false},cancelBackground{false},backgroundDeferred{false};
bool backgroundPriorAvailable=false;
bool backgroundReadDeferred=false; // Worker-owned until completion notification.
LampUpdateAutomatic::Service automaticService;
LampUpdateAutomatic::Snapshot automaticView;
bool automaticJob=false,automaticCommitHeld=false;
bool manualCommitHeld=false;
uint8_t automaticJobOperation=0;
// The worker publishes only bounded evidence after destroying its TLS owner.
// 1 safe precommit error,2 commit fence entered,3 discovery success,4 deferred.
std::atomic<uint8_t> automaticOutcome{0};
bool workerCommitFence=false; // Worker-owned until workerFinished acquire.
FirmwareManifest lastDonorWake{};
bool donorWakeSeen=false,donorNewerSeen=false;
uint32_t donorWakeAt=0;

bool busy(uint8_t phase) { return phase == UPDATE_CHECKING || phase == UPDATE_DOWNLOADING || phase == UPDATE_RESTARTING; }
void phase(uint8_t value, uint8_t error = UPDATE_OK) {
  portENTER_CRITICAL(&mux); status.phase = value; status.error = error;
  if(value==UPDATE_IDLE||value==UPDATE_AVAILABLE||value==UPDATE_ERROR)status.receiving=false;
  portEXIT_CRITICAL(&mux);
}
void startReceiverCue(){
  const auto light=getLampControlState();
  portENTER_CRITICAL(&mux);status.receiving=true;status.cueOn=light.power;status.cueBrightness=light.brightness;status.writtenOffset=0;status.totalBytes=0;if(!++status.cueGeneration)++status.cueGeneration;portEXIT_CRITICAL(&mux);
}
void fail(uint8_t error) { phase(UPDATE_ERROR, error); }
String versionText(const uint16_t v[3]) {
  String out;
  if(!out.concat(v[0])||!out.concat('.')||!out.concat(v[1])||!out.concat('.')||!out.concat(v[2]))return String();
  return out;
}
bool legacyAttemptMatches(const FirmwareManifest& artifact){
  char version[18];snprintf(version,sizeof(version),"%u.%u.%u",unsigned(artifact.version[0]),unsigned(artifact.version[1]),unsigned(artifact.version[2]));
  return !strcmp(version,attemptedVersion);
}

bool checkRelease(bool installing = false,bool background = false,uint32_t backgroundBudget=LampUpdateControlPolicy::BackgroundBudgetMs) {
  UpdateHttp http; int code = 0; int64_t length = 0;
  // Discovery must bypass a cached Latest redirect. Installation rechecks the
  // exact offered release, never a second Latest lookup that could go backward.
  const char* manifestName=UpdatePublisher::enforced()?"coollamp-manifest-v2.txt":"coollamp-manifest.txt";
  const String path = installing ? String("download/firmware-v") + versionText(candidate.version) + "/" + manifestName :
    String("latest/download/") + manifestName + "?check=" + String(esp_random(), HEX);
  if (!http.open(String(ROOT) + path, code, length,background?&cancelBackground:nullptr,
                 background?backgroundBudget:LampUpdateControlPolicy::ExplicitBudgetMs)) {
    if(background&&(http.cancelled()||http.memoryFailure())){backgroundReadDeferred=true;return false;}
    fail(http.memoryFailure()?UPDATE_MEMORY:UPDATE_NETWORK);return false;
  }
  char text[UpdatePublisher::ManifestCapacity] = {}; size_t used = 0;
  if (code == 200 && (length < 0 || length < sizeof(text))) {
    while (used < sizeof(text) - 1) {
      const int n = http.read(text + used, sizeof(text) - 1 - used);
      if (n < 0) { used = sizeof(text); break; }
      if (!n) break;
      used += n;
    }
  }
  const bool complete = http.complete();
  http.close();
  if(background&&cancelBackground.load()){backgroundReadDeferred=true;return false;}
  if (code == 404) {
    if (installing) { fail(UPDATE_MANIFEST); return false; }
    portENTER_CRITICAL(&mux); status.available = false; memset(status.latest, 0, sizeof(status.latest)); portEXIT_CRITICAL(&mux);
    phase(UPDATE_IDLE); return true;
  }
  FirmwareManifest next{};
  uint32_t nextEpoch=0;bool validManifest=false;
  const bool textComplete=used<sizeof(text)-1&&strlen(text)==used;
  if(textComplete&&!strncmp(text,"COOLLAMP-OTA-2\n",15)){
    UpdatePublisher::Manifest signedManifest;
    validManifest=UpdatePublisher::verifyProvisioned(text,used,signedManifest);
    if(validManifest){next=signedManifest.image;nextEpoch=signedManifest.epoch;}
  }else if(textComplete&&!UpdatePublisher::enforced())validManifest=parseFirmwareManifest(text,next);
  if (code != 200 || !complete || !textComplete || !validManifest) {
    fail(code == 200 ? UPDATE_MANIFEST : UPDATE_NETWORK); return false;
  }
  if (installing && (!sameFirmwareManifest(next, candidate)||nextEpoch!=candidateEpoch||(nextEpoch&&strcmp(text,signedCandidate)))) { fail(UPDATE_MANIFEST); return false; }
  const auto* target = esp_ota_get_next_update_partition(nullptr);
  if (!target || target->size < 2031616 || next.size > target->size) { fail(UPDATE_PARTITION); return false; }
  const bool newer = firmwareIsNewer(next.version, CURRENT);
  if(background&&cancelBackground.load()){backgroundReadDeferred=true;return false;}
  portENTER_CRITICAL(&mux);
  candidate = next; candidateEpoch=nextEpoch;if(nextEpoch)strlcpy(signedCandidate,text,sizeof(signedCandidate));else signedCandidate[0]=0;memcpy(status.latest, next.version, sizeof(status.latest));status.checkedAt=millis();
  status.available = newer; status.progress = 0;
  portEXIT_CRITICAL(&mux);
  phase(newer ? (installing ? UPDATE_CHECKING : UPDATE_AVAILABLE) : UPDATE_IDLE); return true;
}
bool recordAttempt(const String& version) {
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool ok = prefs.putString("otaAttempt", version) == version.length(); prefs.end();
  if (ok) strlcpy(attemptedVersion, version.c_str(), sizeof(attemptedVersion));
  return ok;
}
void downloadRelease() {
  phase(UPDATE_DOWNLOADING);
  const FirmwareManifest selected = candidate;
  portENTER_CRITICAL(&mux);status.totalBytes=selected.size;portEXIT_CRITICAL(&mux);
  const String version = versionText(selected.version);
  UpdateHttp http; int code = 0; int64_t length = 0;
  if (!http.open(String(ROOT) + "download/firmware-v" + version + "/CoolLamp.ino.bin", code, length)) { fail(http.memoryFailure()?UPDATE_MEMORY:UPDATE_NETWORK); return; }
  if (code != 200 || length != selected.size) { http.close(); fail(UPDATE_IMAGE); return; }
  const auto* target = esp_ota_get_next_update_partition(nullptr);
  esp_ota_handle_t ota = 0;
  uint8_t buffer[1024], digest[32]; size_t received = 0,written=0;
  mbedtls_sha256_context hash; mbedtls_sha256_init(&hash);
  bool ok = !mbedtls_sha256_starts(&hash,0) && target && target->size >= 2031616 && esp_ota_begin(target, selected.size, &ota) == ESP_OK;
  const uint32_t started = millis();
  // Prefix may arrive in fragments. Validate before writing the first byte to OTA.
  constexpr size_t PREFIX = sizeof(esp_image_header_t) + sizeof(esp_image_segment_header_t) + sizeof(esp_app_desc_t);
  size_t prefixUsed = 0; uint8_t prefix[PREFIX]; bool headerValid = false;
  while (ok && received < selected.size && millis() - started < 180000) {
    const size_t want = min(sizeof(buffer), size_t(selected.size - received));
    const int n = http.read(reinterpret_cast<char*>(buffer), want);
    if (n <= 0) { ok = false; break; }
    if(mbedtls_sha256_update(&hash,buffer,n)){ok=false;break;}
    size_t offset = 0;
    if (!headerValid) {
      const size_t take = min(size_t(n), PREFIX - prefixUsed);
      memcpy(prefix + prefixUsed, buffer, take); prefixUsed += take; offset += take;
      if (prefixUsed == PREFIX) {
        esp_image_header_t image; esp_app_desc_t app;
        memcpy(&image, prefix, sizeof(image));
        memcpy(&app, prefix + sizeof(image) + sizeof(esp_image_segment_header_t), sizeof(app));
        headerValid = image.magic == ESP_IMAGE_HEADER_MAGIC && image.chip_id == CONFIG_IDF_FIRMWARE_CHIP_ID && app.magic_word == ESP_APP_DESC_MAGIC_WORD;
        ok = headerValid && esp_ota_write(ota, prefix, PREFIX) == ESP_OK;
        if(ok)written=PREFIX;
      }
    }
    if (ok && headerValid && offset < size_t(n)){ok = esp_ota_write(ota, buffer + offset, n - offset) == ESP_OK;if(ok)written+=n-offset;}
    received += n;
    portENTER_CRITICAL(&mux);status.writtenOffset=written;status.progress=written*100ULL/selected.size;portEXIT_CRITICAL(&mux);
    vTaskDelay(1);
  }
  const bool hashed=!mbedtls_sha256_finish(&hash,digest);mbedtls_sha256_free(&hash);
  http.close();
  ok = ok && hashed && headerValid && received == selected.size && !memcmp(digest, selected.sha256, 32);
  if (!ok) { if (ota) esp_ota_abort(ota); fail(UPDATE_IMAGE); return; }
  if(esp_ota_end(ota)!=ESP_OK){fail(UPDATE_IMAGE);return;}
  if(candidateEpoch&&(!UpdatePublisher::retainManifest(signedCandidate,strlen(signedCandidate))||!UpdatePublisher::recordEpoch(candidateEpoch))){fail(UPDATE_STORAGE);return;}
  // Retain the legacy version guard for supported old rollback images, but do
  // not quarantine a version merely because its network download was tried.
  // A failure anywhere inside the durable fence is never an automatic replay.
  workerCommitFence=true;
  if(!LampUpdateAttempt::prepare(selected,explicitRepair)||!recordAttempt(version)){fail(UPDATE_STORAGE);return;}
  if(esp_ota_set_boot_partition(target)!=ESP_OK){fail(UPDATE_IMAGE);return;}
  phase(UPDATE_RESTARTING);
}
void installRelease() {
  // Keep the manifest and download stack frames separate on this small device.
  // Revalidate the offered version, size and hash before downloading its image.
  if (checkRelease(true) && getLampUpdateStatus().available) downloadRelease();
}
void updateTask(void*) {
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
  const auto run=[&]{
    portENTER_CRITICAL(&mux); const uint8_t operation = job;const bool background=jobBackground; job = 0; portEXIT_CRITICAL(&mux);
    backgroundReadDeferred=false;
    bool completed=false;
    // The worker alone owns/destroys TLS. The loop may only request cancellation.
    const auto finishBackground=[&]{
      if(background){
        if(!completed&&(cancelBackground.load()||backgroundReadDeferred)){
          phase(backgroundPriorAvailable?UPDATE_AVAILABLE:UPDATE_IDLE);
          backgroundDeferred=true;
        }
        backgroundActive=false;
      }
    };
    if(background&&cancelBackground.load()){finishBackground();return;}
    if (WiFi.status() != WL_CONNECTED) { fail(UPDATE_OFFLINE);finishBackground();return; }
    const uint32_t started = millis();
    const uint32_t clockBudget=background?LampUpdateControlPolicy::BackgroundBudgetMs:15000;
    while (time(nullptr) < 1700000000 && uint32_t(millis()-started)<clockBudget&&!(background&&cancelBackground.load())) vTaskDelay(pdMS_TO_TICKS(100));
    if(background&&cancelBackground.load()){finishBackground();return;}
    if (time(nullptr) < 1700000000) { fail(UPDATE_CLOCK);finishBackground();return; }
    const uint32_t elapsed=uint32_t(millis()-started);
    const uint32_t left=background&&elapsed<LampUpdateControlPolicy::BackgroundBudgetMs?LampUpdateControlPolicy::BackgroundBudgetMs-elapsed:0;
    if(background&&!left){fail(UPDATE_CLOCK);finishBackground();return;}
    if (operation == 2) installRelease(); else completed=checkRelease(false,background,left);
    finishBackground();
  };
  run();
  // Every HTTPS origin publishes the durable fence, including Update now.
  // A failed boot-selection reply is uncertain, not permission to try BLE.
  const auto completed=getLampUpdateStatus();
  automaticOutcome=workerCommitFence?2:completed.phase==UPDATE_ERROR?1:
    (completed.phase==UPDATE_IDLE||completed.phase==UPDATE_AVAILABLE)?3:4;
  workerFinished.store(true,std::memory_order_release);
  // Never self-delete or execute another job. The loop deletes this blocked
  // task after observing completion; until then its handle/stack stay valid.
  for(;;)ulTaskNotifyTake(pdTRUE,portMAX_DELAY);
}
bool request(uint8_t operation,bool manualRepair=false,bool background=false) {
  if (worker || !healthy || LampCommission::working() || lampWifiSetupBusy() || lampFactoryResetPending() || lampFactoryResetArmed()) return false;
  if(backgroundActive.load())return false;
  // Automatic discovery waits without taking audio/radio ownership or advancing
  // its pending deadline. Explicit Check now / Update now are separate paths.
  const bool automaticInstall=operation==2&&!manualRepair&&getLampUpdateStatus().automatic;
  if((background||automaticInstall)&&!LampUpdateControlPolicy::backgroundStartReady(lampControlTrafficIdle(millis()),heap_caps_get_free_size(MALLOC_CAP_8BIT),heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),sizeof(StaticTask_t)))return false;
  FirmwareManifest offered;
  portENTER_CRITICAL(&mux);
  if(manual||busy(status.phase)||job||(operation==2&&!status.available)){portEXIT_CRITICAL(&mux);return false;}
  offered=candidate;portEXIT_CRITICAL(&mux);
  if(operation==2&&!lampRolloutAllowsAutomaticUpdate(offered))return false;
  if(operation==2&&!manualRepair&&!lampAutomaticUpdateArtifactAllowed(offered))return false;
  portENTER_CRITICAL(&mux);
  if (manual || busy(status.phase) || job) { portEXIT_CRITICAL(&mux); return false; }
  if (operation == 2 && !status.available) { portEXIT_CRITICAL(&mux); return false; }
  job = operation;jobBackground=background;backgroundPriorAvailable=status.available;
  cancelBackground=false;backgroundActive=background;
  status.phase = UPDATE_CHECKING; status.error = 0;explicitRepair=manualRepair;
  automaticJob=automaticInstall||(background&&status.automatic);automaticJobOperation=operation;workerCommitFence=false;automaticOutcome=0;
  portEXIT_CRITICAL(&mux);
  // request() runs on the loop task. Do not wake HTTPS until DMA is released.
  if (!stopLampAudio()) {
    portENTER_CRITICAL(&mux); job = 0; portEXIT_CRITICAL(&mux);
    backgroundActive=false;
    automaticJob=false;
    handoff.cancel();
    fail(UPDATE_MEMORY); return false;
  }
  if(operation==2&&!lampRolloutAutomaticUpdateStarted(offered)){
    portENTER_CRITICAL(&mux);job=0;portEXIT_CRITICAL(&mux);automaticJob=false;handoff.cancel();fail(UPDATE_STORAGE);return false;
  }
  // Do not notify inside a consumed RPC/HTTP handler. The request's caller
  // still owns response/form temporaries, and group-radio cleanup may be next
  // loop. serviceLampUpdater() dispatches after the resource owners have run.
  if(operation==2){startReceiverCue();setLampUpdateRoute(UPDATE_ROUTE_INTERNET);}
  if(automaticJob){automaticService.enable();automaticService.internetStarted();}
  handoff.queue();return true;
}
} // namespace

void beginLampUpdater() {
  LampUpdateAttempt::begin();
  bootHealth.begin(millis());
  Preferences prefs;
  if (prefs.begin("coollamp", true)) {
    status.automatic = prefs.getBool("autoUpdate", false);
    const String attempted = prefs.getString("otaAttempt", "");
    strlcpy(attemptedVersion, attempted.c_str(), sizeof(attemptedVersion)); prefs.end();
  }
  Preferences policyPrefs;
  if(policyPrefs.begin("coollamp",true)){
    uint8_t record[LampUpdatePolicy::RecordSize]{};
    const size_t length=policyPrefs.getBytesLength("updatePolicyV1");
    if(policyPrefs.isKey("updatePolicyV1")&&!(length==sizeof(record)&&policyPrefs.getBytes("updatePolicyV1",record,sizeof(record))==sizeof(record)&&LampUpdatePolicy::decode(record,length,updatePolicy,policyRevision))){
      // Corrupt policy never silently removes a quiet-hours restriction.
      updatePolicy.window=true;updatePolicy.startMinute=0;updatePolicy.endMinute=1;
      policyReadable=false;
      status.automatic=false;
    }
    policyPrefs.end();
  }else{status.automatic=false;policyReadable=false;}
  setenv("TZ",updatePolicy.timezone,1);tzset();
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  nextCheck = millis() + 60000 + esp_random() % 30000;
  automaticService.disable();automaticView={};automaticCommitHeld=false;
  manualCommitHeld=false;
}
LampUpdateStatus getLampUpdateStatus() {
  portENTER_CRITICAL(&mux); const auto copy = status; portEXIT_CRITICAL(&mux); return copy;
}
bool requestLampUpdateCheck() { return request(1); }
bool requestLampUpdateInstall() { return request(2,true); }
bool setLampAutoUpdate(bool enabled) {
  if (lampRemoteUpdateBusy()) return false;
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool saved = prefs.putBool("autoUpdate", enabled) == 1; prefs.end();
  if (saved) { portENTER_CRITICAL(&mux); status.automatic = enabled; portEXIT_CRITICAL(&mux);
    if(enabled){automaticService.enable();nextCheck=millis();}else{automaticService.disable();automaticView={};}
  }
  return saved;
}
bool lampRemoteUpdateBusy() { return lampUpdateOwnsResources(); }
bool lampUpdateOwnsResources() {
  portENTER_CRITICAL(&mux); const bool result = manual || worker || job || busy(status.phase); portEXIT_CRITICAL(&mux);
  return result;
}
bool reserveLampManualUpdate() {
  if (!healthy || LampCommission::working() || lampWifiSetupBusy() || lampFactoryResetPending() || lampFactoryResetArmed()) return false;
  portENTER_CRITICAL(&mux);
  const bool ok = !manual && !worker && !busy(status.phase) && !job;
  if (ok) manual = true;
  portEXIT_CRITICAL(&mux);
  if (ok && !stopLampAudio()) { releaseLampManualUpdate(); return false; }
  return ok;
}
void releaseLampManualUpdate() { portENTER_CRITICAL(&mux);if(!manualCommitHeld)manual=false;status.receiving=false;portEXIT_CRITICAL(&mux); }
bool beginLampBluetoothUpdate() {
  if(!reserveLampManualUpdate())return false;
  if(!beginLampBluetoothUpdateRadio()){releaseLampManualUpdate();return false;}
  startReceiverCue();
  setLampUpdateRoute(UPDATE_ROUTE_BLUETOOTH);
  portENTER_CRITICAL(&mux);status.phase=UPDATE_DOWNLOADING;status.error=0;status.progress=0;status.available=false;portEXIT_CRITICAL(&mux);
  return true;
}
void setLampBluetoothUpdateProgress(uint32_t received,uint32_t total) {
  portENTER_CRITICAL(&mux);status.writtenOffset=received;status.totalBytes=total;status.progress=total?received*100ULL/total:0;portEXIT_CRITICAL(&mux);
}
void finishLampBluetoothUpdate(bool verified,bool cancelled) {
  portENTER_CRITICAL(&mux);
  if(manualCommitHeld){portEXIT_CRITICAL(&mux);return;}
  manual=false;status.phase=verified?UPDATE_RESTARTING:cancelled?UPDATE_IDLE:UPDATE_ERROR;
  status.error=verified||cancelled?UPDATE_OK:UPDATE_IMAGE;status.progress=verified?100:0;
  status.receiving=verified;
  portEXIT_CRITICAL(&mux);
  finishLampBluetoothUpdateRadio(verified);
}
void holdLampUpdateCommitUnconfirmed(){
  portENTER_CRITICAL(&mux);
  manual=true;manualCommitHeld=true;automaticCommitHeld=true;
  status.phase=UPDATE_ERROR;status.error=UPDATE_STORAGE;
  status.receiving=false;status.cueOn=false;
  portEXIT_CRITICAL(&mux);
  finishLampBluetoothUpdateRadio(false);
}
static void serviceAutomaticUpdates(uint32_t now,const LampUpdateStatus& current){
  using namespace LampUpdateAutomatic;
  if(manualCommitHeld){automaticView=automaticService.snapshot(now);automaticView.state=Waiting;automaticView.reason=CommitUnconfirmed;automaticView.attention=true;automaticView.phoneFallback=false;return;}
  if(!current.automatic){automaticService.disable();automaticView={};donorWakeSeen=donorNewerSeen=false;lastDonorWake={};return;}
  automaticService.enable();automaticService.discovered(current.available||donorNewerSeen||automaticService.snapshot(now).newerSeen);
  automaticView=automaticService.snapshot(now);
  const auto hold=[&](uint8_t reason,bool attention=false){automaticView.state=Waiting;automaticView.reason=reason;automaticView.attention=attention;automaticView.phoneFallback=false;};
  if(current.phase==UPDATE_RESTARTING){automaticView.state=Committing;automaticView.reason=Ready;automaticView.attention=automaticView.phoneFallback=false;return;}
  const auto donor=LampFirmwareRelay::discoverySnapshot(now);
  if(donor.state==1||donor.state==2){automaticView.state=DonorTransfer;automaticView.reason=Ready;automaticView.attention=automaticView.phoneFallback=false;return;}
  if(worker||job||manual||busy(current.phase)){hold(UpdaterBusy);if(automaticJob){automaticView.state=Internet;automaticView.reason=Ready;}return;}
  if(!healthy){hold(BootHealth);return;}
  const auto discoverWhileHeld=[&]{
    // Discovery does not confer group/window permission to install. Retain the
    // legacy ability to learn a release while that independent gate is held.
    if(!current.available&&automaticService.due(now)&&WiFi.status()==WL_CONNECTED)
      request(1,false,true);
  };
  const auto quiet=policyEligibility();
  if(quiet!=LampUpdatePolicy::Ready){const uint8_t reasons[]={Ready,Ready,ActiveUse,ClockUnknown,QuietWindow,InvalidPolicy};hold(reasons[quiet<=5?quiet:5]);if(quiet!=LampUpdatePolicy::InvalidPolicy)discoverWhileHeld();return;}
  const uint8_t group=lampRolloutAutomaticAdmissionReason();
  if(group){const uint8_t reasons[]={Ready,GroupStage,GroupLegacy,GroupStorage,GroupPermit};hold(reasons[group<=4?group:4],current.available);discoverWhileHeld();return;}
  if(automaticCommitHeld){hold(CommitUnconfirmed,true);return;}
  if(current.available&&!lampAutomaticUpdateArtifactAllowed(candidate)){
    const bool legacy=legacyAttemptMatches(candidate);
    const auto attempt=LampUpdateAttempt::automaticAdmissionReason(candidate);
    hold(legacy?LegacyAttempt:(attempt==LampUpdateAttempt::Unavailable||attempt==LampUpdateAttempt::Full)?AttemptStorage:attempt==LampUpdateAttempt::InvalidArtifact?Partition:ArtifactQuarantine,true);return;
  }
  if(current.available&&!lampRolloutAllowsAutomaticUpdate(candidate)){hold(GroupPermit,true);return;}
  if(automaticService.due(now)){
    uint8_t fallback=Ready;
    if(WiFi.status()!=WL_CONNECTED)fallback=InternetUnavailable;
    else if(!lampControlTrafficIdle(now))fallback=ControlBusy;
    else if(!LampUpdateControlPolicy::backgroundStartReady(true,heap_caps_get_free_size(MALLOC_CAP_8BIT),heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),sizeof(StaticTask_t)))fallback=Memory;
    else if(request(current.available?2:1,false,!current.available)){
      automaticView=automaticService.snapshot(now);automaticView.state=Internet;automaticView.reason=Ready;return;
    }else fallback=getLampUpdateStatus().error==UPDATE_STORAGE?AttemptStorage:UpdaterBusy;
    automaticService.fallback(now,fallback,esp_random());automaticView=automaticService.snapshot(now);
  }
  if(automaticService.donorsAllowed()){
    if(!donor.paired)automaticView.reason=FleetUnpaired;
    else if(!donor.radioAvailable)automaticView.reason=RadioUnavailable;
    // This is observation of authenticated periodic offers, not an RF scan or
    // a promise that compatible channels/trust/donors exist nearby.
    else if(!automaticView.donorWaitMs&&automaticView.reason!=Memory&&automaticView.reason!=ControlBusy)automaticView.reason=DonorUnavailable;
  }
}
void serviceLampUpdater() {
  const uint32_t now = millis();
  if(worker&&workerFinished.load(std::memory_order_acquire)){
    // No TLS, NVS or candidate access remains in the completed task. Remove
    // the handle before any later request/status builder can observe it.
    const TaskHandle_t completed=worker;worker=nullptr;
    vTaskDelete(completed);workerFinished=false;
    const uint8_t outcome=automaticOutcome.exchange(0);
    const auto finished=getLampUpdateStatus();
    if(outcome==2&&finished.phase!=UPDATE_RESTARTING){
      // Keep a loop-owned reservation through error/status reads, disconnect,
      // opt-out and route changes. Only reboot can reconcile this durable fence.
      holdLampUpdateCommitUnconfirmed();
    }
    if(automaticJob){
      if(outcome==1){
        automaticService.fallback(now,finished.error==UPDATE_MANIFEST?LampUpdateAutomatic::ManifestRejected:finished.error==UPDATE_PARTITION?LampUpdateAutomatic::Partition:LampUpdateAutomatic::InternetFailed,esp_random());
        if(finished.available)phase(UPDATE_AVAILABLE,finished.error);
      }else if(outcome==3&&automaticJobOperation==1){
        if(!finished.available&&donorNewerSeen)automaticService.fallback(now,LampUpdateAutomatic::InternetUnavailable,esp_random());
        else automaticService.checked(now,finished.available);
      }
      else if(outcome==4)automaticService.fallback(now,LampUpdateAutomatic::ControlBusy,esp_random());
    }
    automaticJob=false;
  }
  serviceLampUpdatePolicy(now);
  if(backgroundActive.load()&&!lampControlTrafficIdle(now))cancelBackground=true;
  if(backgroundDeferred.exchange(false))nextCheck=now;
  if (!healthy && bootHealth.observe(now)) {
    esp_ota_img_states_t state;
    const auto* running = esp_ota_get_running_partition();
    if (esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
      if (esp_ota_mark_app_valid_cancel_rollback() != ESP_OK) return;
    }
    healthy = true;
  }
  // A responsive loop alone cannot clear an artifact quarantine. Wait for the
  // incremental running-image measurement, and bound failed clear retries.
  static bool healthAttempted=false;static uint32_t nextHealthAttempt=0;
  if(healthy&&!lampUpdateOwnsResources()&&(!healthAttempted||int32_t(now-nextHealthAttempt)>=0)){
    healthAttempted=true;nextHealthAttempt=now+60000;
    FirmwareManifest measured{};esp_ota_img_states_t imageState;
    const auto* running=esp_ota_get_running_partition();
    if(running&&esp_ota_get_state_partition(running,&imageState)==ESP_OK&&imageState==ESP_OTA_IMG_VALID&&LampFirmwareRelay::runningManifest(measured))LampUpdateAttempt::confirmHealthy(measured);
  }
  // CoolLamp's loop services Network and Bluetooth before this point. Crossing
  // a full subsequent pass covers HTTP, BLE, USB and automatic request origins,
  // including a BLE request made after the current loop's group service pass.
  if(handoff.service()){
    // An accepted request has crossed the existing full-loop ownership
    // barrier. Only now allocate its stack; idle lamps retain no HTTPS task.
    if(jobBackground&&!LampUpdateControlPolicy::backgroundStartReady(lampControlTrafficIdle(now),heap_caps_get_free_size(MALLOC_CAP_8BIT),heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),sizeof(StaticTask_t))){
      portENTER_CRITICAL(&mux);job=0;portEXIT_CRITICAL(&mux);
      backgroundActive=false;backgroundDeferred=true;
      phase(backgroundPriorAvailable?UPDATE_AVAILABLE:UPDATE_IDLE);handoff.cancel();return;
    }
    workerFinished=false;
    if(xTaskCreate(updateTask,"lamp-update",LampUpdateControlPolicy::WorkerStackBytes,nullptr,1,&worker)!=pdPASS){
      worker=nullptr;portENTER_CRITICAL(&mux);job=0;portEXIT_CRITICAL(&mux);
      backgroundActive=false;automaticJob=false;handoff.cancel();fail(UPDATE_MEMORY);return;
    }
    xTaskNotifyGive(worker);return;
  }
  const auto current = getLampUpdateStatus();
  static uint8_t previousPhase = UPDATE_IDLE;
  if (current.phase == UPDATE_ERROR && previousPhase != UPDATE_ERROR) nextCheck = now + 15UL * 60 * 1000 + esp_random() % 60000;
  previousPhase = current.phase;
  serviceAutomaticUpdates(now,current);
  if (current.phase == UPDATE_RESTARTING) {
    if(manual)return; // Browser upload retains Network's existing reply/restart owner.
    if (!restartAt) restartAt = now + 2000;
    if (static_cast<int32_t>(now - restartAt) >= 0) ESP.restart();
    return;
  }
  if (WiFi.status() != WL_CONNECTED || manual || busy(current.phase)) return;
  if(current.automatic)return;
  if (static_cast<int32_t>(now - nextCheck) >= 0) {
    if (request(1,false,true)) nextCheck = now + 6UL * 60 * 60 * 1000 + esp_random() % 300000;
  }
}
void getLampUpdatePacket(uint8_t* out) {
  const auto s = getLampUpdateStatus(); memset(out, 0, 20);
  out[0] = 1; out[1] = s.phase; out[2] = s.automatic; out[3] = WiFi.status() == WL_CONNECTED;
  out[4] = s.progress; out[5] = s.error;
  for (unsigned i = 0; i < 3; ++i) {
    out[6+i*2] = CURRENT[i]; out[7+i*2] = CURRENT[i] >> 8;
    out[12+i*2] = s.latest[i]; out[13+i*2] = s.latest[i] >> 8;
  }
  out[18] = s.available;
}
LampUpdateJsonSnapshot captureLampUpdateJson(bool includeAutomatic) {
  LampUpdateJsonSnapshot snapshot;snapshot.status=getLampUpdateStatus();
  FirmwareManifest offered;portENTER_CRITICAL(&mux);offered=candidate;portEXIT_CRITICAL(&mux);
  snapshot.attempt=LampUpdateAttempt::captureStatus(offered);
  snapshot.policy=captureLampUpdatePolicyJson();snapshot.http=captureUpdateHttpDiagnostics();
  snapshot.heap=ESP.getFreeHeap();snapshot.largest=heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  snapshot.workerStack=worker?uxTaskGetStackHighWaterMark(worker):0;snapshot.loopStack=uxTaskGetStackHighWaterMark(nullptr);
  snapshot.wifi=WiFi.status()==WL_CONNECTED;snapshot.healthy=healthy;snapshot.publisher=UpdatePublisher::enforced();
  if(includeAutomatic){
    snapshot.automaticService=automaticView;const auto timing=automaticService.snapshot(millis());
    snapshot.automaticService.retryInMs=timing.retryInMs;snapshot.automaticService.donorWaitMs=timing.donorWaitMs;
    // Same immutable 48-bit hardware identity as lampIdentity(), without a
    // String allocation retained while the complete reply is reserved.
    const uint64_t mac=ESP.getEfuseMac();const char hex[]="0123456789abcdef";
    for(unsigned i=0;i<12;++i)snapshot.deviceId[i]=hex[(mac>>(44-i*4))&15];
  }
  return snapshot;
}
void appendLampUpdateJson(LampJsonSink& out,const LampUpdateJsonSnapshot& snapshot,bool includeAutomatic) {
  const auto& s=snapshot.status;const auto add=[&](const auto& value){out.concat(value);};
  add("{\"version\":\"");
  add(LAMP_FIRMWARE_VERSION);add("\",\"build\":\"");
#ifdef COOL_LAMP_PUBLIC_RELEASE
  add("COOLLAMP-PUBLIC-" LAMP_FIRMWARE_VERSION);
#else
  add("COOLLAMP-LOCAL-" LAMP_FIRMWARE_VERSION);
#endif
  add("\",\"latest\":\"");add(s.latest[0]);add('.');add(s.latest[1]);add('.');add(s.latest[2]);
  add("\",\"phase\":");add(s.phase);add(",\"progress\":");add(s.progress);add(",\"error\":");add(s.error);
  add(",\"automatic\":");add((s.automatic?"true":"false"));add(",\"available\":");add((s.available?"true":"false"));
  add(",\"wifi\":");add((snapshot.wifi?"true":"false"));
  add(",\"updateContractVersion\":2,\"route\":");add(s.route);add(",\"checkedAt\":");add(s.checkedAt);
  add(",\"receiver\":");add((s.receiving?"true":"false"));add(",\"writtenOffset\":");add(s.writtenOffset);add(",\"totalBytes\":");add(s.totalBytes);
  add(",\"freeHeap\":");add(snapshot.heap);add(",\"largestBlock\":");add(snapshot.largest);
  add(",\"workerStackFree\":");add(snapshot.workerStack);add(",\"loopStackFree\":");add(snapshot.loopStack);
  add(",\"bootHealthy\":");add((snapshot.healthy?"true":"false"));add(",\"healthGate\":\"loop-continuity-v1\",\"publisherEnforced\":");add((snapshot.publisher?"true":"false"));
  add(",\"publisherDonation\":true,\"bleResumeLifetimeMs\":120000,\"bleResumeMinMtu\":53,\"bleResumeAcrossReboot\":false,\"fleetLease\":true,\"fleetLeaseMode\":\"protected-orchestration-v1\",\"automaticRadioRollout\":false,\"attemptGuard\":");
  LampUpdateAttempt::appendStatus(out,snapshot.attempt);
  add(",\"policy\":");
  appendLampUpdatePolicyJson(out,snapshot.policy);
  appendUpdateHttpDiagnostics(out,snapshot.http);
  if(includeAutomatic){
    if(strlen(snapshot.deviceId)!=12){out.fail();return;}
    const auto& a=snapshot.automaticService;
    add(",\"deviceId\":\"");add(snapshot.deviceId);add("\",\"automaticService\":{\"version\":1,\"state\":");add(a.state);
    add(",\"reason\":");add(a.reason);add(",\"retryInMs\":");add(a.retryInMs);add(",\"donorWaitMs\":");add(a.donorWaitMs);
    add(",\"internetAttempts\":");add(a.internetAttempts);add(",\"donorOffers\":");add(a.donorOffers);
    add(",\"attention\":");add(a.attention?"true":"false");add(",\"phoneFallback\":");add(a.phoneFallback?"true":"false");
    add(",\"newerSeen\":");add(a.newerSeen?"true":"false");add('}');
  }
  add('}');
}
String lampUpdateJson() {
  const auto snapshot=captureLampUpdateJson(true);
  String out=lampJsonReply([&](LampJsonSink& reply){appendLampUpdateJson(reply,snapshot,true);});
  const char* const httpKeys[]={"httpStage","httpCode","httpHost","tlsError","tlsFlags","transportError"};
  if(!LampHttpJson::requiredKeys(out.c_str(),out.length(),httpKeys,sizeof(httpKeys)/sizeof(httpKeys[0])))return String();
  return out;
}

void noteLampUpdateUse(){lastUserUse=millis();userUseObserved=true;}
void beginLampManualUpdateCue(){
  portENTER_CRITICAL(&mux);const bool admitted=manual&&!manualCommitHeld&&!status.receiving&&!busy(status.phase);portEXIT_CRITICAL(&mux);
  if(!admitted)return;
  startReceiverCue();setLampUpdateRoute(UPDATE_ROUTE_MANUAL_UPLOAD);
  phase(UPDATE_DOWNLOADING);
}
void finishLampManualUpdate(bool verified,bool commitUnconfirmed){
  portENTER_CRITICAL(&mux);
  if(!manual||!status.receiving||status.route!=UPDATE_ROUTE_MANUAL_UPLOAD){portEXIT_CRITICAL(&mux);return;}
  status.receiving=false;status.cueOn=false;
  status.phase=verified?UPDATE_RESTARTING:UPDATE_ERROR;
  status.error=verified?UPDATE_OK:commitUnconfirmed?UPDATE_STORAGE:UPDATE_IMAGE;
  if(verified)status.progress=100;
  manualCommitHeld=commitUnconfirmed;
  if(!verified&&!commitUnconfirmed)manual=false;
  portEXIT_CRITICAL(&mux);
}
void setLampManualUpdateCueProgress(uint32_t written){portENTER_CRITICAL(&mux);status.writtenOffset=written;status.totalBytes=0;status.progress=0;portEXIT_CRITICAL(&mux);}
void setLampManualUpdateCueProgress(uint32_t written,uint32_t total){
  if(!total||total>2031616||written>total)return;
  portENTER_CRITICAL(&mux);
  if(manual&&status.receiving){status.writtenOffset=written;status.totalBytes=total;status.progress=written*100ULL/total;}
  portEXIT_CRITICAL(&mux);
}
void setLampUpdateRoute(uint8_t route){if(route>UPDATE_ROUTE_MANUAL_UPLOAD)return;portENTER_CRITICAL(&mux);if(status.receiving)status.route=route;portEXIT_CRITICAL(&mux);}
bool lampBootHealthy(){return healthy;}
static bool reconcileUncertainPolicy();
bool lampRolloutRecoveryPreflight(const FirmwareManifest& pinned){
  // A started lease never expires into another target. Only this verified
  // current-boot snapshot can support renewing the same artifact/target lease.
  if(pinned.size<288||pinned.size>2031616||!healthy||LampCommission::working()||lampWifiSetupBusy()||lampFactoryResetPending()||lampFactoryResetArmed()||lampNetworkRestartPending())return false;
  portENTER_CRITICAL(&mux);const bool owned=manual||worker||busy(status.phase)||job||restartAt||status.receiving;portEXIT_CRITICAL(&mux);
  if(owned)return false;
  const auto* running=esp_ota_get_running_partition();const auto* selected=esp_ota_get_boot_partition();
  if(!running||!selected||running->flash_chip!=selected->flash_chip||running->address!=selected->address||running->size!=selected->size||running->type!=selected->type||running->subtype!=selected->subtype)return false;
  esp_ota_img_states_t state;
  if(esp_ota_get_state_partition(running,&state)!=ESP_OK||state!=ESP_OTA_IMG_VALID)return false;
  const auto control=getLampControlState();if(!control.mode||control.mode>lampAvailableEffectCount()||!control.brightness)return false;
  FirmwareManifest measured{};
  return LampFirmwareRelay::runningManifest(measured)&&measured.size>=288&&measured.size<=running->size&&memcmp(measured.sha256,pinned.sha256,32)!=0;
}
uint32_t lampUpdatePolicyRevision(){if(policyNeedsReconcile)reconcileUncertainPolicy();return policyRevision;}
static LampUpdatePolicy::Eligibility policyEligibility(){
  if(!policyReadable)return LampUpdatePolicy::InvalidPolicy;
  const time_t utc=time(nullptr);const bool valid=utc>=1700000000;struct tm local{};
  const bool converted=valid&&localtime_r(&utc,&local);
  return LampUpdatePolicy::eligibility(updatePolicy,getLampUpdateStatus().automatic,converted,
    converted?uint16_t(local.tm_hour*60+local.tm_min):1440,millis(),userUseObserved,lastUserUse);
}
bool lampAutomaticUpdateAllowed(){
  // Opt-in and quiet policy do not establish a staged group rollout. An
  // unarmed, unpaused legacy follower can update individually while keeping membership;
  // legacy coordinators and expanded groups still need their coordination
  // fence. Both internet and donor admission share this gate, and explicit
  // manual requests keep the separate exact-artifact rollout fence.
  return policyEligibility()==LampUpdatePolicy::Ready&&lampRolloutAutomaticAdmissionReason()==0;
}
bool lampAutomaticUpdateArtifactAllowed(const FirmwareManifest& artifact){
  return !automaticCommitHeld&&!manualCommitHeld&&!legacyAttemptMatches(artifact)&&LampUpdateAttempt::automaticAllowed(artifact);
}
bool lampAutomaticDonorDiscoveryAllowed(){return automaticService.donorsAllowed()&&!automaticCommitHeld&&!manualCommitHeld;}
void noteLampAutomaticDonorOffer(const FirmwareManifest& artifact){
  if(!getLampUpdateStatus().automatic)return;
  const uint32_t now=millis();donorNewerSeen=true;
  const bool different=!donorWakeSeen||!sameFirmwareManifest(lastDonorWake,artifact);
  const bool wake=!automaticService.donorsAllowed()&&!lampUpdateOwnsResources()&&!automaticCommitHeld&&different&&
    (!donorWakeSeen||uint32_t(now-donorWakeAt)>=LampUpdateAutomatic::RetryMs);
  if(wake){lastDonorWake=artifact;donorWakeSeen=true;donorWakeAt=now;}
  automaticService.enable();automaticService.observedOffer(wake);
}
bool lampUpdatePolicySaveUncertain(){return policySaveUncertain;}
class UpdatePolicyPreferences:public Preferences {
 public:
  bool snapshot(uint8_t out[LampUpdatePolicy::RecordSize],bool& absent){
    // Preferences convenience reads collapse error and absence. Preserve the
    // pinned NVS result so a failed read cannot prove that a save did not run.
    size_t size=LampUpdatePolicy::RecordSize;
    const esp_err_t error=nvs_get_blob(_handle,"updatePolicyV1",out,&size);
    absent=error==ESP_ERR_NVS_NOT_FOUND;
    return absent||(error==ESP_OK&&size==LampUpdatePolicy::RecordSize);
  }
};
static bool reconcileUncertainPolicy(){
  if(!policyNeedsReconcile)return true;
  UpdatePolicyPreferences prefs;if(!prefs.begin("coollamp",true))return false;
  uint8_t record[LampUpdatePolicy::RecordSize]{};bool absent=false;
  const bool known=prefs.snapshot(record,absent);prefs.end();if(!known)return false;
  LampUpdatePolicy::Policy stored;uint32_t revision=0;
  if(!absent&&LampUpdatePolicy::decode(record,sizeof(record),stored,revision)){
    updatePolicy=stored;policyRevision=revision;policyReadable=true;setenv("TZ",stored.timezone,1);tzset();
  }else policyReadable=false; // Known corrupt/absent storage needs deliberate owner repair.
  policyNeedsReconcile=false;return true;
}
void serviceLampUpdatePolicy(uint32_t now){
  // Status reads are RAM-only. Reconcile an uncertain durable save on its
  // owner loop, at most once per second while storage remains unavailable.
  if(policyNeedsReconcile&&!lampUpdateOwnsResources()&&(!policyReconcileAttempted||uint32_t(now-policyReconcileAttemptAt)>=1000)){
    policyReconcileAttempted=true;policyReconcileAttemptAt=now;reconcileUncertainPolicy();
  }
  if(!policyNeedsReconcile)policyReconcileAttempted=false;
  if(userUseObserved&&uint32_t(now-lastUserUse)>=updatePolicy.idleSeconds*1000UL)userUseObserved=false;
}
bool setLampUpdatePolicy(const LampUpdatePolicy::Policy& next,uint32_t expectedRevision){
  // An uncertain write may have advanced durable revision. Never overwrite it
  // using a stale RAM revision merely because the read failed at the boundary.
  if(policyNeedsReconcile&&!reconcileUncertainPolicy())return false;
  policySaveUncertain=false;
  if(lampUpdateOwnsResources()||expectedRevision!=policyRevision||policyRevision==UINT32_MAX||!LampUpdatePolicy::valid(next))return false;
  uint8_t record[LampUpdatePolicy::RecordSize];LampUpdatePolicy::encode(next,policyRevision+1,record);
  UpdatePolicyPreferences prefs;if(!prefs.begin("coollamp",false))return false;
  uint8_t prior[LampUpdatePolicy::RecordSize]{};bool priorAbsent=false;
  const bool priorKnown=prefs.snapshot(prior,priorAbsent);
  bool saved=prefs.putBytes("updatePolicyV1",record,sizeof(record))==sizeof(record);
  prefs.end();
  if(!saved){
    uint8_t observed[LampUpdatePolicy::RecordSize]{};bool observedAbsent=false;
    UpdatePolicyPreferences verify;
    const bool opened=verify.begin("coollamp",true);
    const bool observedKnown=opened&&verify.snapshot(observed,observedAbsent);
    if(opened)verify.end();
    if(observedKnown&&!observedAbsent&&!memcmp(observed,record,sizeof(record)))saved=true;
    else if(!(priorKnown&&observedKnown&&priorAbsent==observedAbsent&&(priorAbsent||!memcmp(observed,prior,sizeof(prior))))){
      policySaveUncertain=true;policyNeedsReconcile=true;policyReadable=false;policyReconcileAttempted=false;
    }
  }
  if(!saved)return false;
  updatePolicy=next;policyReadable=true;++policyRevision;setenv("TZ",updatePolicy.timezone,1);tzset();return true;
}
LampUpdatePolicyJsonSnapshot captureLampUpdatePolicyJson(){
  LampUpdatePolicyJsonSnapshot snapshot;
  snapshot.policy=updatePolicy;snapshot.revision=policyRevision;snapshot.valid=policyReadable;
  snapshot.eligibility=policyEligibility();snapshot.coordination=lampRolloutAutomaticAdmissionSnapshotReason();
  return snapshot;
}
void appendLampUpdatePolicyJson(LampJsonSink& out,const LampUpdatePolicyJsonSnapshot& snapshot){
  // Production policies are validated before entering loop-owned memory. Keep
  // malformed/nonterminated captured data from publishing incomplete JSON.
  if(!memchr(snapshot.policy.timezone,0,sizeof(snapshot.policy.timezone))){out.fail();return;}
  const auto& policy=snapshot.policy;
  const auto add=[&](const auto& value){out.concat(value);};
  add("{\"version\":1,\"valid\":");
  add((snapshot.valid?"true":"false"));add(",\"revision\":");add(snapshot.revision);add(",\"window\":");add((policy.window?"true":"false"));
  add(",\"startMinute\":");add(policy.startMinute);add(",\"endMinute\":");add(policy.endMinute);add(",\"timezone\":");out.quote(policy.timezone);
  add(",\"deferDuringUse\":");add((policy.deferDuringUse?"true":"false"));add(",\"idleSeconds\":");add(policy.idleSeconds);
  add(",\"eligibility\":");add(uint8_t(snapshot.eligibility));add(",\"groupCoordination\":");add(snapshot.coordination);
  add(",\"automaticEligible\":");add((snapshot.eligibility==LampUpdatePolicy::Ready&&snapshot.coordination==0?"true":"false"));add(",\"unknownTime\":\"wait\",\"restartResume\":false,\"automaticRadioRollout\":false}");
}
String lampUpdatePolicyJson(){
  const auto snapshot=captureLampUpdatePolicyJson();
  return lampJsonReply([&](LampJsonSink& out){appendLampUpdatePolicyJson(out,snapshot);});
}
