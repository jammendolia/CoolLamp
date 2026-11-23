#pragma once

using portMUX_TYPE = int;
inline constexpr portMUX_TYPE portMUX_INITIALIZER_UNLOCKED = 0;

#define portENTER_CRITICAL(mux) ((void)(mux))
#define portEXIT_CRITICAL(mux) ((void)(mux))
