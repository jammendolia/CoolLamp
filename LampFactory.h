#pragma once
#include <string.h>
// Public first-setup credential. Saved owner credentials always take precedence.
constexpr char LAMP_FACTORY_PASSWORD[] = "coollamp";
static_assert(sizeof(LAMP_FACTORY_PASSWORD) >= 9 && sizeof(LAMP_FACTORY_PASSWORD) <= 64,
              "Hotspot password must have 8–63 characters");
inline bool lampUsesFactoryPassword(const char* password) {
  return strcmp(password,LAMP_FACTORY_PASSWORD)==0;
}
