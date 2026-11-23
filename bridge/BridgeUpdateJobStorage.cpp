#include "BridgeUpdateJobStorage.h"

#include <nvs.h>

namespace BridgeUpdateJobStorage {
namespace {
constexpr char Namespace[] = "bridgejob2";
constexpr char Key[] = "jobV2";

BridgeUpdateJob::LoadResult load(void*, BridgeUpdateJob::Record& value) {
  nvs_handle_t handle{};
  const auto opened = nvs_open(Namespace, NVS_READONLY, &handle);
  if (opened == ESP_ERR_NVS_NOT_FOUND) return BridgeUpdateJob::LoadResult::Missing;
  if (opened != ESP_OK) return BridgeUpdateJob::LoadResult::Fault;
  size_t bytes = sizeof(value);
  const auto read = nvs_get_blob(handle, Key, &value, &bytes);
  nvs_close(handle);
  if (read == ESP_ERR_NVS_NOT_FOUND) return BridgeUpdateJob::LoadResult::Missing;
  return read == ESP_OK && bytes == sizeof(value)
           ? BridgeUpdateJob::LoadResult::Loaded
           : BridgeUpdateJob::LoadResult::Fault;
}

bool save(void*, const BridgeUpdateJob::Record& value) {
  nvs_handle_t handle{};
  if (nvs_open(Namespace, NVS_READWRITE, &handle) != ESP_OK) return false;
  const auto written = nvs_set_blob(handle, Key, &value, sizeof(value));
  const auto committed = written == ESP_OK ? nvs_commit(handle) : written;
  nvs_close(handle);
  return written == ESP_OK && committed == ESP_OK;
}

bool clear(void*) {
  nvs_handle_t handle{};
  const auto opened = nvs_open(Namespace, NVS_READWRITE, &handle);
  if (opened == ESP_ERR_NVS_NOT_FOUND) return true;
  if (opened != ESP_OK) return false;
  const auto erased = nvs_erase_key(handle, Key);
  if (erased == ESP_ERR_NVS_NOT_FOUND) { nvs_close(handle); return true; }
  const auto committed = erased == ESP_OK ? nvs_commit(handle) : erased;
  nvs_close(handle);
  return erased == ESP_OK && committed == ESP_OK;
}
}

BridgeUpdateJob::Store preferences() { return {nullptr, load, save, clear}; }

} // namespace BridgeUpdateJobStorage
