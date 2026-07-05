#pragma once

#include "lvgl.h"

LV_IMG_DECLARE(tft_bullet_live);
LV_IMG_DECLARE(tft_bullet_blank);
extern const lv_img_dsc_t *const tft_soup_portraits[4][4];
#define TFT_EXPLOSION_FRAME_COUNT 20
#define TFT_SMOKE_FRAME_COUNT 22
extern const lv_img_dsc_t *const tft_explosion1_frames[TFT_EXPLOSION_FRAME_COUNT];
extern const lv_img_dsc_t *const tft_explosion2_frames[TFT_EXPLOSION_FRAME_COUNT];
extern const lv_img_dsc_t *const tft_smoke_frames[TFT_SMOKE_FRAME_COUNT];
