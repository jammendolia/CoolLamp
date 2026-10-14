#include "../bridge/BridgeUsbProtocol.h"
#include <assert.h>
#include <string>
int main(){
 using namespace BridgeUsbProtocol;Command command;
 auto parseText=[&](const std::string& value){erase(&command,sizeof(command));return parse(value.data(),value.size(),command);};
 assert(parseText("status")&&command.kind==Kind::Status);
 assert(parseText("diagnostics")&&command.kind==Kind::Diagnostics);
 assert(!parseText("diagnostics body")&&!parseText("diagnostics secret value"));
 assert(parseText("wifi 486f6d65 3132333435363738")&&std::string(command.ssid)=="Home"&&std::string(command.password)=="12345678");
 assert(parseText("wifi 486f6d65 -")&&command.password[0]==0);
 assert(!parseText("wifi 486f6d65 3132"));assert(!parseText("wifi 486f6d65 0a3132333435363738"));
 assert(!parseText("wifi 486f6d65 ff00"));assert(!parseText("wifi  486f6d65 -"));
 assert(!parseText("wifi 00 -"));assert(!parseText("wifi 6 -"));assert(!parseText("wifi 486f6d65 - extra"));
 assert(parseText("trust 8c4856dab734 0123456789abcdef 01010101010101010101010101010101")&&command.kind==Kind::Trust);
 assert(!parseText("trust 8c4856dab734 0123456789abcdef 00000000000000000000000000000000"));
 assert(!parseText("trust invalid 0123456789abcdef 01010101010101010101010101010101"));
 assert(!parseText("trust 8c4856dab734 0123456789abcdef 0101010101010101010101010101010G"));
 assert(!parseText(std::string(1025,'a')));assert(!parseText(std::string("status\0hidden",13)));
 erase(&command,sizeof(command));const auto* bytes=reinterpret_cast<const uint8_t*>(&command);for(size_t i=0;i<sizeof(command);++i)assert(bytes[i]==0);
 return 0;
}
