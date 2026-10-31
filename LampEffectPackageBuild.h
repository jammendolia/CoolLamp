#pragma once
// Local measurement switch only. Normal firmware retains every native effect.
// Private .build snapshots enable these; partitions and release flags stay fixed.
#ifndef COOLLAMP_EFFECT_PACK_PROTOTYPE
#define COOLLAMP_EFFECT_PACK_PROTOTYPE 0
#endif
#ifndef COOLLAMP_EFFECT_PACK_REPLACE_NATIVE
#define COOLLAMP_EFFECT_PACK_REPLACE_NATIVE 0
#endif
#ifndef COOLLAMP_EFFECT_PACK_COMPRESSED
#define COOLLAMP_EFFECT_PACK_COMPRESSED 0
#endif
#if COOLLAMP_EFFECT_PACK_REPLACE_NATIVE && !COOLLAMP_EFFECT_PACK_PROTOTYPE
#error Native replacement requires the local package-player prototype
#endif
#if COOLLAMP_EFFECT_PACK_COMPRESSED && !COOLLAMP_EFFECT_PACK_PROTOTYPE
#error Compressed fixtures require the local package-player prototype
#endif
