#pragma once

#include "BridgeUpdateJob.h"

namespace BridgeUpdateJobStorage {

// Dedicated namespace: update receipts never share a blob with bridge Wi-Fi,
// household credentials, lamp links, or the cached artifact descriptor.
BridgeUpdateJob::Store preferences();

} // namespace BridgeUpdateJobStorage
