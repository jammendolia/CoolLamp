#include "../UpdateManifest.h"
#include <assert.h>
#include <string>
bool accepts(std::string value) { FirmwareManifest m{}; return parseFirmwareManifest(&value[0], m); }
int main() {
  const std::string hash(64, 'a');
  const std::string valid = "COOLLAMP-OTA-1\n1.2.0\nesp32c3\ndual-ota-2031616\n1600000\n" + hash + "\n";
  assert(accepts(valid));
  for (size_t i=0; i<valid.size(); ++i) assert(!accepts(valid.substr(0,i)));
  assert(!accepts(valid + "extra"));
  for (const auto& pair : {std::pair<std::string,std::string>{"esp32c3","esp32"}, {"1.2.0","1.02.0"}, {"1.2.0","65536.0.0"}, {"1600000","2031617"}, {"1600000","-1"}, {hash,std::string(64,'z')}}) {
    auto changed=valid; changed.replace(changed.find(pair.first),pair.first.size(),pair.second); assert(!accepts(changed));
  }
  uint16_t current[3]={1,9,9}, newer[3]={1,10,0}, older[3]={1,2,100};
  assert(firmwareIsNewer(newer,current)); assert(!firmwareIsNewer(older,current)); assert(!firmwareIsNewer(current,current));
}
