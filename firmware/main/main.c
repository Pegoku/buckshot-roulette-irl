#include <ctype.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_https_server.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_spiffs.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "qrcode.h"

#define PIN_LCD_MOSI 11
#define PIN_LCD_MISO -1
#define PIN_LCD_SCLK 12
#define PIN_LCD_CS 10
#define PIN_LCD_DC 9
#define PIN_LCD_RST 8
#define PIN_LCD_BL 7
#define PIN_TRIGGER 4

#define LCD_WIDTH 320
#define LCD_HEIGHT 240
#define LCD_HOST SPI2_HOST
#define AP_CHANNEL 6
#define AP_MAX_CLIENTS 8
#define AP_IP "192.168.4.1"

#define MAX_PLAYERS 4
#define MAX_NAME_LEN 15
#define MAX_SHELLS 8
#define MAX_ITEMS 9
#define MAX_TOKENS 40
#define BUTTON_POLL_DELAY_TICKS 1
#define PLAYER_TIMEOUT_MS 20000
#define PLAYER_TIMEOUT_RETRY_MS 2000
#define PLAYER_TIMEOUT_RETRIES 3

#define COLOR_BLACK 0x0000
#define COLOR_WHITE 0xffff
#define COLOR_RED 0xf800
#define COLOR_GREEN 0x07e0
#define COLOR_BLUE 0x001f
#define COLOR_YELLOW 0xffe0
#define COLOR_CYAN 0x07ff
#define COLOR_MAGENTA 0xf81f
#define COLOR_GRAY 0x7bef

typedef enum {
    PHASE_LOBBY,
    PHASE_ACTIVE,
    PHASE_GAME_OVER,
} phase_t;

typedef enum {
    ITEM_ADRENALINE,
    ITEM_BEER,
    ITEM_BURNER,
    ITEM_CIGARETTE,
    ITEM_SAW,
    ITEM_INVERTER,
    ITEM_JAMMER,
    ITEM_GLASS,
    ITEM_REMOTE,
    ITEM_INVALID = -1,
} item_t;

typedef struct {
    bool active;
    bool alive;
    bool skip_turn;
    uint8_t id;
    uint8_t lives;
    uint8_t timeout_strikes;
    uint32_t join_order;
    uint32_t last_seen_ms;
    uint32_t next_timeout_ms;
    char name[MAX_NAME_LEN + 1];
    uint8_t inv[MAX_ITEMS];
} player_t;

typedef struct {
    bool used;
    bool consumed;
    int8_t owner;
    item_t item;
    char payload[48];
} token_t;

typedef struct {
    phase_t phase;
    uint8_t player_count;
    uint8_t admin_id;
    uint32_t next_join_order;
    uint8_t current;
    int8_t direction;
    int8_t armed_target;
    int8_t winner;
    bool nfc_write_mode;
    uint8_t max_lives;
    uint8_t max_shells;
    uint8_t live_shells_setting;
    uint8_t items_per_player;
    uint8_t shell_count;
    uint8_t shell_index;
    uint8_t shells[MAX_SHELLS];
    bool saw_active;
    char message[96];
    player_t players[MAX_PLAYERS];
    token_t tokens[MAX_TOKENS];
} game_t;

static const char *TAG = "buckshot";
static spi_device_handle_t lcd_spi;
static SemaphoreHandle_t game_lock;
static TaskHandle_t display_task_handle;
static game_t game;
static volatile bool trigger_event;
static volatile uint32_t display_version;
static char ap_ssid[32];
static char join_token[17];
static char join_path[32];
static char join_url[64];

extern const unsigned char server_crt_start[] asm("_binary_server_crt_start");
extern const unsigned char server_crt_end[] asm("_binary_server_crt_end");
extern const unsigned char server_key_start[] asm("_binary_server_key_start");
extern const unsigned char server_key_end[] asm("_binary_server_key_end");

static const uint8_t digit_font[10][5] = {
    {0x7, 0x5, 0x5, 0x5, 0x7},
    {0x2, 0x6, 0x2, 0x2, 0x7},
    {0x7, 0x1, 0x7, 0x4, 0x7},
    {0x7, 0x1, 0x7, 0x1, 0x7},
    {0x5, 0x5, 0x7, 0x1, 0x1},
    {0x7, 0x4, 0x7, 0x5, 0x7},
    {0x7, 0x4, 0x7, 0x5, 0x7},
    {0x7, 0x1, 0x1, 0x2, 0x2},
    {0x7, 0x5, 0x7, 0x5, 0x7},
    {0x7, 0x5, 0x7, 0x1, 0x7},
};

static const char *item_names[MAX_ITEMS] = {
    "adrenaline", "beer", "burner", "cigarette", "saw", "inverter", "jammer", "glass", "remote",
};

static uint8_t alive_count(void);
static int next_player_from(int start);
static void set_message(const char *fmt, ...);

static uint32_t now_ms(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000ULL);
}

static void lock_game(void)
{
    xSemaphoreTake(game_lock, portMAX_DELAY);
}

static void unlock_game(void)
{
    xSemaphoreGive(game_lock);
}

static void mark_display_dirty(void)
{
    display_version++;
    if (display_task_handle) {
        xTaskNotifyGive(display_task_handle);
    }
}

static uint16_t color_swap(uint16_t color)
{
    return (color << 8) | (color >> 8);
}

static void lcd_cmd(uint8_t cmd)
{
    spi_transaction_t t = {.length = 8, .tx_buffer = &cmd};
    gpio_set_level(PIN_LCD_DC, 0);
    ESP_ERROR_CHECK(spi_device_polling_transmit(lcd_spi, &t));
}

static void lcd_data(const void *data, int len)
{
    if (len <= 0) {
        return;
    }
    spi_transaction_t t = {.length = len * 8, .tx_buffer = data};
    gpio_set_level(PIN_LCD_DC, 1);
    ESP_ERROR_CHECK(spi_device_polling_transmit(lcd_spi, &t));
}

static void lcd_data_u8(uint8_t data)
{
    lcd_data(&data, 1);
}

static void lcd_set_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1)
{
    uint8_t data[4];
    lcd_cmd(0x2a);
    data[0] = x0 >> 8;
    data[1] = x0 & 0xff;
    data[2] = x1 >> 8;
    data[3] = x1 & 0xff;
    lcd_data(data, sizeof(data));
    lcd_cmd(0x2b);
    data[0] = y0 >> 8;
    data[1] = y0 & 0xff;
    data[2] = y1 >> 8;
    data[3] = y1 & 0xff;
    lcd_data(data, sizeof(data));
    lcd_cmd(0x2c);
}

static void lcd_fill_rect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, uint16_t color)
{
    if (x >= LCD_WIDTH || y >= LCD_HEIGHT || w == 0 || h == 0) {
        return;
    }
    if (x + w > LCD_WIDTH) {
        w = LCD_WIDTH - x;
    }
    if (y + h > LCD_HEIGHT) {
        h = LCD_HEIGHT - y;
    }

    static uint16_t line[LCD_WIDTH];
    uint16_t swapped = color_swap(color);
    for (int i = 0; i < w; i++) {
        line[i] = swapped;
    }
    lcd_set_window(x, y, x + w - 1, y + h - 1);
    gpio_set_level(PIN_LCD_DC, 1);
    for (int row = 0; row < h; row++) {
        spi_transaction_t t = {.length = w * 16, .tx_buffer = line};
        ESP_ERROR_CHECK(spi_device_polling_transmit(lcd_spi, &t));
    }
}

static void lcd_draw_digit(uint16_t x, uint16_t y, int digit, uint16_t color, uint16_t scale)
{
    if (digit < 0 || digit > 9) {
        return;
    }
    for (int row = 0; row < 5; row++) {
        for (int col = 0; col < 3; col++) {
            if (digit_font[digit][row] & (1 << (2 - col))) {
                lcd_fill_rect(x + col * scale, y + row * scale, scale, scale, color);
            }
        }
    }
}

static void lcd_draw_number(uint16_t x, uint16_t y, uint32_t value, uint16_t color, uint16_t scale)
{
    char text[12];
    snprintf(text, sizeof(text), "%lu", (unsigned long)value);
    for (int i = 0; text[i] != '\0'; i++) {
        lcd_draw_digit(x + i * scale * 4, y, text[i] - '0', color, scale);
    }
}

static const uint8_t *font5x7(char c)
{
    static const uint8_t blank[7] = {0, 0, 0, 0, 0, 0, 0};
    static const uint8_t dash[7] = {0, 0, 0, 0x1f, 0, 0, 0};
    static const uint8_t chars[][7] = {
        {0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e}, // 0
        {0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e}, // 1
        {0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f}, // 2
        {0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e}, // 3
        {0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02}, // 4
        {0x1f, 0x10, 0x10, 0x1e, 0x01, 0x01, 0x1e}, // 5
        {0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e}, // 6
        {0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}, // 7
        {0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e}, // 8
        {0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e}, // 9
        {0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11}, // A
        {0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e}, // B
        {0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e}, // C
        {0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e}, // D
        {0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f}, // E
        {0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10}, // F
        {0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0d}, // u
        {0x00, 0x00, 0x0e, 0x10, 0x10, 0x10, 0x0e}, // c
        {0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12}, // k
        {0x00, 0x00, 0x0f, 0x10, 0x0e, 0x01, 0x1e}, // s
        {0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x11}, // h
        {0x00, 0x00, 0x0e, 0x11, 0x11, 0x11, 0x0e}, // o
        {0x08, 0x08, 0x1c, 0x08, 0x08, 0x09, 0x06}, // t
    };
    if (c >= '0' && c <= '9') {
        return chars[c - '0'];
    }
    if (c >= 'A' && c <= 'F') {
        return chars[10 + c - 'A'];
    }
    switch (c) {
    case 'B':
        return chars[11];
    case 'u':
        return chars[16];
    case 'c':
        return chars[17];
    case 'k':
        return chars[18];
    case 's':
        return chars[19];
    case 'h':
        return chars[20];
    case 'o':
        return chars[21];
    case 't':
        return chars[22];
    case '-':
        return dash;
    default:
        return blank;
    }
}

static void lcd_draw_char5x7(uint16_t x, uint16_t y, char c, uint16_t color, uint16_t scale)
{
    const uint8_t *rows = font5x7(c);
    for (int row = 0; row < 7; row++) {
        for (int col = 0; col < 5; col++) {
            if (rows[row] & (1 << (4 - col))) {
                lcd_fill_rect(x + col * scale, y + row * scale, scale, scale, color);
            }
        }
    }
}

static void lcd_draw_text_center(uint16_t y, const char *text, uint16_t color, uint16_t scale)
{
    size_t len = strlen(text);
    uint16_t char_w = 6 * scale;
    uint16_t width = len > 0 ? (len * char_w) - scale : 0;
    uint16_t x = width < LCD_WIDTH ? (LCD_WIDTH - width) / 2 : 0;
    for (size_t i = 0; text[i] != '\0' && x < LCD_WIDTH; i++) {
        lcd_draw_char5x7(x, y, text[i], color, scale);
        x += char_w;
    }
}

static void lcd_draw_token_qr_hint(void)
{
    for (int i = 0; i < 16; i++) {
        uint16_t bit_color = (join_token[i] >= '8' || (join_token[i] >= 'a' && join_token[i] <= 'f')) ? COLOR_WHITE : COLOR_BLUE;
        lcd_fill_rect(18 + i * 18, 210, 12, 18, bit_color);
    }
}

static void lcd_draw_qr_callback(esp_qrcode_handle_t qrcode)
{
    int qr_size = esp_qrcode_get_size(qrcode);
    int module = 5;
    int quiet = 4;
    int total = (qr_size + quiet * 2) * module;
    if (total > 190) {
        module = 4;
        total = (qr_size + quiet * 2) * module;
    }
    int x0 = (LCD_WIDTH - total) / 2;
    int y0 = 42;
    lcd_fill_rect(x0, y0, total, total, COLOR_WHITE);
    for (int y = 0; y < qr_size; y++) {
        for (int x = 0; x < qr_size; x++) {
            if (esp_qrcode_get_module(qrcode, x, y)) {
                lcd_fill_rect(x0 + (x + quiet) * module, y0 + (y + quiet) * module, module, module, COLOR_BLACK);
            }
        }
    }
}

static void lcd_draw_join_qr(const game_t *snap)
{
    lcd_fill_rect(0, 0, LCD_WIDTH, LCD_HEIGHT, COLOR_BLACK);
    lcd_fill_rect(0, 0, LCD_WIDTH, 32, COLOR_BLUE);
    lcd_draw_text_center(6, ap_ssid, COLOR_WHITE, 3);
    esp_qrcode_config_t cfg = ESP_QRCODE_CONFIG_DEFAULT();
    cfg.display_func = lcd_draw_qr_callback;
    cfg.max_qrcode_version = 6;
    cfg.qrcode_ecc_level = ESP_QRCODE_ECC_LOW;
    if (esp_qrcode_generate(&cfg, join_url) != ESP_OK) {
        lcd_draw_token_qr_hint();
    }
    lcd_draw_number(18, 210, snap->player_count, COLOR_WHITE, 6);
    if (snap->admin_id != 255) {
        lcd_draw_number(260, 210, snap->admin_id + 1, COLOR_YELLOW, 6);
    }
}

static void lcd_draw_game_screen(void)
{
    game_t snap;
    lock_game();
    snap = game;
    unlock_game();

    if (snap.phase == PHASE_LOBBY) {
        lcd_draw_join_qr(&snap);
        return;
    }

    lcd_fill_rect(0, 0, LCD_WIDTH, LCD_HEIGHT, COLOR_BLACK);
    uint16_t top = snap.phase == PHASE_LOBBY ? COLOR_BLUE : (snap.phase == PHASE_GAME_OVER ? COLOR_GREEN : COLOR_RED);
    lcd_fill_rect(0, 0, LCD_WIDTH, 32, top);

    lcd_draw_number(16, 50, snap.player_count, COLOR_WHITE, 12);
    lcd_draw_number(84, 50, snap.current + 1, COLOR_CYAN, 12);
    lcd_draw_number(152, 50, snap.shell_index, COLOR_YELLOW, 12);
    lcd_draw_number(220, 50, snap.shell_count, COLOR_MAGENTA, 12);

    int visible = 0;
    for (int i = 0; i < MAX_PLAYERS; i++) {
        if (!snap.players[i].active) {
            continue;
        }
        uint16_t y = 122 + i * 20;
        uint16_t color = snap.players[i].alive ? COLOR_GREEN : COLOR_GRAY;
        y = 122 + visible * 20;
        if (i == snap.current && snap.phase == PHASE_ACTIVE) {
            color = COLOR_YELLOW;
        }
        lcd_fill_rect(18, y, 132, 14, color);
        lcd_draw_number(162, y - 2, snap.players[i].lives, COLOR_WHITE, 4);
        visible++;
    }

    for (int i = snap.shell_index; i < snap.shell_count; i++) {
        uint16_t x = 18 + (i - snap.shell_index) * 34;
        uint16_t color = snap.shells[i] ? COLOR_RED : COLOR_WHITE;
        lcd_fill_rect(x, 184, 24, 14, color);
    }

    lcd_draw_token_qr_hint();
}

static void lcd_init(void)
{
    gpio_config_t out_conf = {
        .pin_bit_mask = (1ULL << PIN_LCD_DC) | (1ULL << PIN_LCD_RST) | (1ULL << PIN_LCD_BL),
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&out_conf));

    spi_bus_config_t buscfg = {
        .mosi_io_num = PIN_LCD_MOSI,
        .miso_io_num = PIN_LCD_MISO,
        .sclk_io_num = PIN_LCD_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = LCD_WIDTH * 40 * 2,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(LCD_HOST, &buscfg, SPI_DMA_CH_AUTO));

    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = 40 * 1000 * 1000,
        .mode = 0,
        .spics_io_num = PIN_LCD_CS,
        .queue_size = 7,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(LCD_HOST, &devcfg, &lcd_spi));

    gpio_set_level(PIN_LCD_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(50));
    gpio_set_level(PIN_LCD_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(120));
    lcd_cmd(0x01);
    vTaskDelay(pdMS_TO_TICKS(120));
    lcd_cmd(0x28);
    lcd_cmd(0x3a);
    lcd_data_u8(0x55);
    lcd_cmd(0x36);
    lcd_data_u8(0x28);
    lcd_cmd(0x11);
    vTaskDelay(pdMS_TO_TICKS(120));
    lcd_cmd(0x29);
    gpio_set_level(PIN_LCD_BL, 1);
    lcd_fill_rect(0, 0, LCD_WIDTH, LCD_HEIGHT, COLOR_BLACK);
}

static const char *phase_name(phase_t phase)
{
    switch (phase) {
    case PHASE_LOBBY:
        return "lobby";
    case PHASE_ACTIVE:
        return "active";
    case PHASE_GAME_OVER:
        return "game_over";
    }
    return "unknown";
}

static item_t parse_item(const char *name)
{
    for (int i = 0; i < MAX_ITEMS; i++) {
        if (strcmp(name, item_names[i]) == 0) {
            return (item_t)i;
        }
    }
    return ITEM_INVALID;
}

static player_t *player_by_id(uint8_t id)
{
    if (id >= MAX_PLAYERS || !game.players[id].active) {
        return NULL;
    }
    return &game.players[id];
}

static void recompute_admin_locked(void)
{
    uint8_t admin = 255;
    uint32_t best_order = UINT32_MAX;
    for (int i = 0; i < MAX_PLAYERS; i++) {
        player_t *p = &game.players[i];
        if (p->active && p->join_order < best_order) {
            best_order = p->join_order;
            admin = p->id;
        }
    }
    if (game.admin_id != admin) {
        game.admin_id = admin;
        if (admin != 255) {
            set_message("%s is admin", game.players[admin].name);
        } else {
            set_message("No admin");
        }
    }
}

static void release_player_tokens_locked(uint8_t pid)
{
    for (int i = 0; i < MAX_TOKENS; i++) {
        if (game.tokens[i].owner == pid && !game.tokens[i].consumed) {
            game.tokens[i].owner = -1;
        }
    }
}

static void remove_player_locked(uint8_t pid, const char *reason)
{
    player_t *p = player_by_id(pid);
    if (!p) {
        return;
    }
    char name[MAX_NAME_LEN + 1];
    strlcpy(name, p->name, sizeof(name));
    release_player_tokens_locked(pid);
    memset(p, 0, sizeof(*p));
    if (game.player_count > 0) {
        game.player_count--;
    }
    if (game.current == pid && game.phase == PHASE_ACTIVE && alive_count() > 0) {
        game.current = next_player_from(pid);
    }
    recompute_admin_locked();
    set_message("%s left: %s", name, reason);
}

static void update_player_seen_locked(int pid)
{
    player_t *p = player_by_id(pid);
    if (!p) {
        return;
    }
    p->last_seen_ms = now_ms();
    p->timeout_strikes = 0;
    p->next_timeout_ms = 0;
}

static void cleanup_timeouts_locked(void)
{
    uint32_t now = now_ms();
    for (int i = 0; i < MAX_PLAYERS; i++) {
        player_t *p = &game.players[i];
        if (!p->active) {
            continue;
        }
        if (p->last_seen_ms == 0) {
            p->last_seen_ms = now;
            continue;
        }
        if (p->timeout_strikes == 0) {
            if ((uint32_t)(now - p->last_seen_ms) >= PLAYER_TIMEOUT_MS) {
                p->timeout_strikes = 1;
                p->next_timeout_ms = now + PLAYER_TIMEOUT_RETRY_MS;
            }
            continue;
        }
        if ((int32_t)(now - p->next_timeout_ms) >= 0) {
            p->timeout_strikes++;
            p->next_timeout_ms = now + PLAYER_TIMEOUT_RETRY_MS;
            if (p->timeout_strikes >= PLAYER_TIMEOUT_RETRIES) {
                remove_player_locked(p->id, "timeout");
            }
        }
    }
}

static uint8_t live_remaining(void)
{
    uint8_t live = 0;
    for (int i = game.shell_index; i < game.shell_count; i++) {
        if (game.shells[i]) {
            live++;
        }
    }
    return live;
}

static uint8_t alive_count(void)
{
    uint8_t count = 0;
    for (int i = 0; i < MAX_PLAYERS; i++) {
        if (game.players[i].active && game.players[i].alive) {
            count++;
        }
    }
    return count;
}

static int8_t find_winner(void)
{
    int8_t winner = -1;
    for (int i = 0; i < MAX_PLAYERS; i++) {
        if (game.players[i].active && game.players[i].alive) {
            winner = i;
        }
    }
    return alive_count() == 1 ? winner : -1;
}

static void save_tokens_locked(void)
{
    nvs_handle_t nvs;
    if (nvs_open("buckshot", NVS_READWRITE, &nvs) != ESP_OK) {
        return;
    }
    token_t persisted[MAX_TOKENS];
    memcpy(persisted, game.tokens, sizeof(persisted));
    for (int i = 0; i < MAX_TOKENS; i++) {
        persisted[i].owner = -1;
        persisted[i].consumed = false;
    }
    nvs_set_blob(nvs, "tokens", persisted, sizeof(persisted));
    nvs_commit(nvs);
    nvs_close(nvs);
}

static void load_tokens_locked(void)
{
    nvs_handle_t nvs;
    if (nvs_open("buckshot", NVS_READONLY, &nvs) != ESP_OK) {
        return;
    }
    size_t len = sizeof(game.tokens);
    if (nvs_get_blob(nvs, "tokens", game.tokens, &len) != ESP_OK || len != sizeof(game.tokens)) {
        memset(game.tokens, 0, sizeof(game.tokens));
    }
    for (int i = 0; i < MAX_TOKENS; i++) {
        game.tokens[i].owner = -1;
        game.tokens[i].consumed = false;
    }
    nvs_close(nvs);
}

static void set_message(const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    vsnprintf(game.message, sizeof(game.message), fmt, args);
    va_end(args);
    mark_display_dirty();
}

static int next_player_from(int start)
{
    for (int step = 0; step < MAX_PLAYERS; step++) {
        start += game.direction;
        if (start < 0) {
            start = MAX_PLAYERS - 1;
        }
        if (start >= MAX_PLAYERS) {
            start = 0;
        }
        player_t *p = player_by_id(start);
        if (p && p->alive) {
            if (p->skip_turn) {
                p->skip_turn = false;
                set_message("%s was jammed and skips", p->name);
                continue;
            }
            return start;
        }
    }
    return game.current;
}

static void advance_turn(void)
{
    game.armed_target = -1;
    game.saw_active = false;
    int next = next_player_from(game.current);
    game.current = next;
}

static void shuffle_shells(void)
{
    uint8_t live = game.live_shells_setting;
    if (live >= game.max_shells) {
        live = game.max_shells - 1;
    }
    if (live == 0) {
        live = 1;
    }
    game.shell_count = game.max_shells;
    game.shell_index = 0;
    for (int i = 0; i < game.shell_count; i++) {
        game.shells[i] = i < live ? 1 : 0;
    }
    for (int i = game.shell_count - 1; i > 0; i--) {
        int j = esp_random() % (i + 1);
        uint8_t tmp = game.shells[i];
        game.shells[i] = game.shells[j];
        game.shells[j] = tmp;
    }
}

static void give_random_items(void)
{
    for (int p = 0; p < MAX_PLAYERS; p++) {
        if (!game.players[p].active || !game.players[p].alive) {
            continue;
        }
        for (int i = 0; i < game.items_per_player; i++) {
            game.players[p].inv[esp_random() % MAX_ITEMS]++;
        }
    }
}

static void reload_if_needed(void)
{
    if (game.phase == PHASE_ACTIVE && game.shell_index >= game.shell_count) {
        shuffle_shells();
        give_random_items();
        set_message("New load: %u live, %u blank", live_remaining(), game.shell_count - live_remaining());
    }
}

static void check_game_over(void)
{
    int8_t winner = find_winner();
    if (winner >= 0) {
        game.winner = winner;
        game.phase = PHASE_GAME_OVER;
        game.armed_target = -1;
        set_message("%s wins", game.players[winner].name);
    }
}

static void resolve_shot(void)
{
    if (game.phase != PHASE_ACTIVE || game.armed_target < 0 || game.shell_index >= game.shell_count) {
        return;
    }
    player_t *shooter = player_by_id(game.current);
    player_t *target = player_by_id(game.armed_target);
    if (!shooter || !target || !shooter->alive || !target->alive) {
        game.armed_target = -1;
        mark_display_dirty();
        return;
    }

    bool live = game.shells[game.shell_index++] != 0;
    uint8_t damage = game.saw_active && live ? 2 : 1;
    bool keep_turn = !live && target->id == shooter->id;

    if (live) {
        if (target->lives > damage) {
            target->lives -= damage;
        } else {
            target->lives = 0;
            target->alive = false;
        }
        set_message("%s shot %s for %u", shooter->name, target->name, damage);
    } else {
        set_message("%s fired a blank at %s", shooter->name, target->name);
    }

    game.armed_target = -1;
    game.saw_active = false;
    check_game_over();
    if (game.phase == PHASE_ACTIVE) {
        reload_if_needed();
        if (!keep_turn) {
            advance_turn();
        }
    }
}

static void game_reset(void)
{
    token_t tokens[MAX_TOKENS];
    memcpy(tokens, game.tokens, sizeof(tokens));
    memset(&game, 0, sizeof(game));
    memcpy(game.tokens, tokens, sizeof(game.tokens));
    for (int i = 0; i < MAX_TOKENS; i++) {
        game.tokens[i].owner = -1;
        game.tokens[i].consumed = false;
    }
    game.phase = PHASE_LOBBY;
    game.admin_id = 255;
    game.current = 0;
    game.direction = 1;
    game.armed_target = -1;
    game.winner = -1;
    game.nfc_write_mode = false;
    game.next_join_order = 1;
    game.max_lives = 3;
    game.max_shells = 6;
    game.live_shells_setting = 3;
    game.items_per_player = 2;
    set_message("Join from QR URL");
}

static bool is_admin(int pid)
{
    return pid >= 0 && pid < MAX_PLAYERS && game.players[pid].active && game.admin_id == pid;
}

static int clamp_int(int value, int min, int max)
{
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

static void sanitize_name(char *dst, size_t dst_size, const char *src)
{
    size_t out = 0;
    for (size_t i = 0; src[i] && out + 1 < dst_size; i++) {
        char c = src[i];
        if (isalnum((unsigned char)c) || c == '_' || c == '-') {
            dst[out++] = c;
        }
    }
    if (out == 0) {
        snprintf(dst, dst_size, "Player");
    } else {
        dst[out] = '\0';
    }
}

static void url_decode(char *s)
{
    char *o = s;
    for (char *p = s; *p; p++) {
        if (*p == '+') {
            *o++ = ' ';
        } else if (*p == '%' && isxdigit((unsigned char)p[1]) && isxdigit((unsigned char)p[2])) {
            char hex[3] = {p[1], p[2], '\0'};
            *o++ = (char)strtol(hex, NULL, 16);
            p += 2;
        } else {
            *o++ = *p;
        }
    }
    *o = '\0';
}

static bool param_get(const char *body, const char *key, char *out, size_t out_len)
{
    size_t key_len = strlen(key);
    const char *p = body;
    while (p && *p) {
        if (strncmp(p, key, key_len) == 0 && p[key_len] == '=') {
            p += key_len + 1;
            size_t i = 0;
            while (*p && *p != '&' && i + 1 < out_len) {
                out[i++] = *p++;
            }
            out[i] = '\0';
            url_decode(out);
            return true;
        }
        p = strchr(p, '&');
        if (p) {
            p++;
        }
    }
    return false;
}

static int param_int(const char *body, const char *key, int fallback)
{
    char value[16];
    return param_get(body, key, value, sizeof(value)) ? atoi(value) : fallback;
}

static int query_int(httpd_req_t *req, const char *key, int fallback)
{
    size_t len = httpd_req_get_url_query_len(req) + 1;
    if (len <= 1 || len > 128) {
        return fallback;
    }
    char query[128];
    char value[16];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        return fallback;
    }
    if (httpd_query_key_value(query, key, value, sizeof(value)) != ESP_OK) {
        return fallback;
    }
    return atoi(value);
}

static esp_err_t read_body(httpd_req_t *req, char *buf, size_t len)
{
    int total = 0;
    while (total < req->content_len && total + 1 < len) {
        int got = httpd_req_recv(req, buf + total, len - total - 1);
        if (got <= 0) {
            return ESP_FAIL;
        }
        total += got;
    }
    buf[total] = '\0';
    return ESP_OK;
}

static void send_json(httpd_req_t *req, const char *json)
{
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

static void send_error(httpd_req_t *req, const char *msg)
{
    char json[160];
    snprintf(json, sizeof(json), "{\"ok\":false,\"error\":\"%s\"}", msg);
    httpd_resp_set_status(req, "400 Bad Request");
    send_json(req, json);
}

static esp_err_t api_state(httpd_req_t *req)
{
    char json[2300];
    char *w = json;
    char *end = json + sizeof(json);
    int pid = query_int(req, "pid", -1);
    lock_game();
    update_player_seen_locked(pid);
    bool known_player = pid >= 0 && pid < MAX_PLAYERS && game.players[pid].active;
    uint8_t live = live_remaining();
    uint8_t blank = game.shell_count - game.shell_index - live;
    w += snprintf(w, end - w,
                  "{\"ok\":true,\"ap\":\"%s\",\"join\":\"%s\",\"phase\":\"%s\",\"message\":\"%s\","
                  "\"you\":%s,\"admin\":%u,\"player_count\":%u,\"current\":%u,\"winner\":%d,\"write_mode\":%s,\"shell_index\":%u,\"shell_count\":%u,"
                  "\"live_remaining\":%u,\"blank_remaining\":%u,\"armed_target\":%d,",
                  ap_ssid, join_path, phase_name(game.phase), game.message, known_player ? "true" : "false",
                  game.admin_id, game.player_count, game.current, game.winner,
                  game.nfc_write_mode ? "true" : "false", game.shell_index, game.shell_count, live, blank, game.armed_target);
    if (game.armed_target >= 0 && game.armed_target < MAX_PLAYERS && game.players[game.armed_target].active) {
        w += snprintf(w, end - w, "\"armed_target_name\":\"%s\",", game.players[game.armed_target].name);
    } else {
        w += snprintf(w, end - w, "\"armed_target_name\":\"\",");
    }
    w += snprintf(w, end - w, "\"players\":[");
    bool first_player = true;
    for (int i = 0; i < MAX_PLAYERS; i++) {
        if (!game.players[i].active) {
            continue;
        }
        player_t *p = &game.players[i];
        w += snprintf(w, end - w, "%s{\"id\":%u,\"name\":\"%s\",\"lives\":%u,\"alive\":%s,\"admin\":%s,\"inv\":[",
                      first_player ? "" : ",", p->id, p->name, p->lives, p->alive ? "true" : "false",
                      p->id == game.admin_id ? "true" : "false");
        first_player = false;
        for (int item = 0; item < MAX_ITEMS; item++) {
            w += snprintf(w, end - w, "%s%u", item == 0 ? "" : ",", p->inv[item]);
        }
        w += snprintf(w, end - w, "]}");
    }
    snprintf(w, end - w, "]}");
    unlock_game();
    send_json(req, json);
    return ESP_OK;
}

static esp_err_t api_register(httpd_req_t *req)
{
    char body[160], name[MAX_NAME_LEN + 1], json[96];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    char raw[48] = "";
    param_get(body, "name", raw, sizeof(raw));
    sanitize_name(name, sizeof(name), raw);

    lock_game();
    if (game.phase != PHASE_LOBBY || game.player_count >= MAX_PLAYERS) {
        unlock_game();
        send_error(req, "registration closed");
        return ESP_OK;
    }
    int id = -1;
    for (int i = 0; i < MAX_PLAYERS; i++) {
        if (!game.players[i].active) {
            id = i;
            break;
        }
    }
    player_t *p = &game.players[id];
    memset(p, 0, sizeof(*p));
    p->active = true;
    p->alive = true;
    p->id = id;
    p->lives = game.max_lives;
    p->join_order = game.next_join_order++;
    p->last_seen_ms = now_ms();
    strlcpy(p->name, name, sizeof(p->name));
    game.player_count++;
    recompute_admin_locked();
    set_message("%s joined", p->name);
    bool admin = game.admin_id == id;
    unlock_game();

    snprintf(json, sizeof(json), "{\"ok\":true,\"pid\":%d,\"admin\":%d}", id, admin ? 1 : 0);
    send_json(req, json);
    return ESP_OK;
}

static esp_err_t api_setup(httpd_req_t *req)
{
    char body[160];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    lock_game();
    if (!is_admin(pid) || game.phase != PHASE_LOBBY) {
        unlock_game();
        send_error(req, "admin only");
        return ESP_OK;
    }
    game.max_lives = clamp_int(param_int(body, "lives", game.max_lives), 1, 9);
    game.max_shells = clamp_int(param_int(body, "shells", game.max_shells), 2, MAX_SHELLS);
    game.live_shells_setting = clamp_int(param_int(body, "live", game.live_shells_setting), 1, game.max_shells - 1);
    game.items_per_player = clamp_int(param_int(body, "items", game.items_per_player), 0, 8);
    for (int i = 0; i < MAX_PLAYERS; i++) {
        if (game.players[i].active) {
            game.players[i].lives = game.max_lives;
            game.players[i].alive = true;
        }
    }
    set_message("Setup saved");
    unlock_game();
    send_json(req, "{\"ok\":true}");
    return ESP_OK;
}

static esp_err_t api_start(httpd_req_t *req)
{
    char body[80];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    lock_game();
    if (!is_admin(pid) || game.player_count < 2) {
        unlock_game();
        send_error(req, "need admin and 2 players");
        return ESP_OK;
    }
    game.phase = PHASE_ACTIVE;
    game.winner = -1;
    game.direction = 1;
    game.armed_target = -1;
    game.saw_active = false;
    for (int i = 0; i < MAX_PLAYERS; i++) {
        if (game.players[i].active) {
            game.players[i].alive = true;
            game.players[i].lives = game.max_lives;
            game.players[i].skip_turn = false;
            memset(game.players[i].inv, 0, sizeof(game.players[i].inv));
        }
    }
    do {
        game.current = esp_random() % MAX_PLAYERS;
    } while (!game.players[game.current].active);
    shuffle_shells();
    give_random_items();
    set_message("Round started");
    unlock_game();
    send_json(req, "{\"ok\":true}");
    return ESP_OK;
}

static esp_err_t api_arm(httpd_req_t *req)
{
    char body[80];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    int target = param_int(body, "target", -1);
    lock_game();
    player_t *shooter = player_by_id(pid);
    player_t *t = player_by_id(target);
    if (game.phase != PHASE_ACTIVE || !shooter || !t || !shooter->alive || !t->alive || game.current != pid) {
        unlock_game();
        send_error(req, "bad shot");
        return ESP_OK;
    }
    game.armed_target = target;
    set_message("%s armed shot at %s", shooter->name, t->name);
    unlock_game();
    send_json(req, "{\"ok\":true}");
    return ESP_OK;
}

static void decrement_item(player_t *p, item_t item)
{
    if (p->inv[item] > 0) {
        p->inv[item]--;
    }
    for (int i = 0; i < MAX_TOKENS; i++) {
        token_t *t = &game.tokens[i];
        if (t->used && !t->consumed && t->owner == p->id && t->item == item) {
            t->consumed = true;
            save_tokens_locked();
            mark_display_dirty();
            return;
        }
    }
}

static esp_err_t api_item(httpd_req_t *req)
{
    char body[160], item_name[24];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    int target = param_int(body, "target", -1);
    param_get(body, "item", item_name, sizeof(item_name));
    item_t item = parse_item(item_name);

    lock_game();
    player_t *p = player_by_id(pid);
    player_t *t = player_by_id(target);
    if (game.phase != PHASE_ACTIVE || !p || !p->alive || game.current != pid || item == ITEM_INVALID || p->inv[item] == 0) {
        unlock_game();
        send_error(req, "bad item");
        return ESP_OK;
    }

    decrement_item(p, item);
    switch (item) {
    case ITEM_BEER:
        if (game.shell_index < game.shell_count) {
            bool live = game.shells[game.shell_index++] != 0;
            set_message("Beer ejected a %s", live ? "live" : "blank");
            reload_if_needed();
        }
        break;
    case ITEM_BURNER:
        if (game.shell_index + 1 < game.shell_count) {
            int idx = game.shell_index + 1 + (esp_random() % (game.shell_count - game.shell_index - 1));
            set_message("Burner: shell %d is %s", idx + 1, game.shells[idx] ? "live" : "blank");
        } else {
            set_message("Burner found no future shell");
        }
        break;
    case ITEM_CIGARETTE:
        if (p->lives < game.max_lives) {
            p->lives++;
        }
        set_message("%s healed", p->name);
        break;
    case ITEM_SAW:
        game.saw_active = true;
        set_message("Next live shot deals 2");
        break;
    case ITEM_INVERTER:
        if (game.shell_index < game.shell_count) {
            game.shells[game.shell_index] = !game.shells[game.shell_index];
        }
        set_message("Current shell inverted");
        break;
    case ITEM_JAMMER:
        if (t && t->alive && t->id != p->id) {
            t->skip_turn = true;
            set_message("%s jammed %s", p->name, t->name);
        } else {
            p->inv[item]++;
            unlock_game();
            send_error(req, "select target");
            return ESP_OK;
        }
        break;
    case ITEM_GLASS:
        if (game.shell_index < game.shell_count) {
            set_message("Current shell is %s", game.shells[game.shell_index] ? "live" : "blank");
        }
        break;
    case ITEM_REMOTE:
        game.direction *= -1;
        set_message("Turn order reversed");
        break;
    case ITEM_ADRENALINE:
        if (t && t->alive && t->id != p->id) {
            for (int i = 1; i < MAX_ITEMS; i++) {
                if (t->inv[i]) {
                    t->inv[i]--;
                    p->inv[i]++;
                    set_message("%s stole %s", p->name, item_names[i]);
                    break;
                }
            }
        } else {
            p->inv[item]++;
            unlock_game();
            send_error(req, "select target");
            return ESP_OK;
        }
        break;
    default:
        break;
    }
    unlock_game();
    send_json(req, "{\"ok\":true}");
    return ESP_OK;
}

static esp_err_t api_scan(httpd_req_t *req)
{
    char body[180], payload[64];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    param_get(body, "payload", payload, sizeof(payload));

    lock_game();
    player_t *p = player_by_id(pid);
    if (!p) {
        unlock_game();
        send_error(req, "unknown player");
        return ESP_OK;
    }
    item_t item = ITEM_INVALID;
    for (int i = 0; i < MAX_TOKENS; i++) {
        if (game.tokens[i].used && strcmp(game.tokens[i].payload, payload) == 0) {
            item = game.tokens[i].item;
            break;
        }
    }
    if (item == ITEM_INVALID && strncmp(payload, "buckshot:item:", 14) == 0) {
        char item_part[24];
        strlcpy(item_part, payload + 14, sizeof(item_part));
        char *colon = strchr(item_part, ':');
        if (colon) {
            *colon = '\0';
        }
        item = parse_item(item_part);
    }
    if (item == ITEM_INVALID) {
        unlock_game();
        send_error(req, "unknown tag");
        return ESP_OK;
    }
    for (int i = 0; i < MAX_TOKENS; i++) {
        token_t *tok = &game.tokens[i];
        if (tok->used && strcmp(tok->payload, payload) == 0) {
            if (tok->consumed) {
                unlock_game();
                send_error(req, "tag consumed");
                return ESP_OK;
            }
            if (tok->owner == p->id) {
                unlock_game();
                send_error(req, "tag already scanned");
                return ESP_OK;
            }
            if (tok->owner >= 0 && tok->owner != p->id) {
                unlock_game();
                send_error(req, "tag owned by another player");
                return ESP_OK;
            }
            tok->owner = p->id;
            save_tokens_locked();
            break;
        }
    }
    p->inv[item]++;
    set_message("%s scanned %s", p->name, item_names[item]);
    unlock_game();
    send_json(req, "{\"ok\":true}");
    return ESP_OK;
}

static esp_err_t api_write_token(httpd_req_t *req)
{
    char body[120], item_name[24], json[120];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    param_get(body, "item", item_name, sizeof(item_name));
    item_t item = parse_item(item_name);
    lock_game();
    if (!is_admin(pid) || item == ITEM_INVALID) {
        unlock_game();
        send_error(req, "admin only");
        return ESP_OK;
    }
    if (!game.nfc_write_mode) {
        unlock_game();
        send_error(req, "enable NFC write mode");
        return ESP_OK;
    }
    int slot = -1;
    for (int i = 0; i < MAX_TOKENS; i++) {
        if (!game.tokens[i].used) {
            slot = i;
            break;
        }
    }
    if (slot < 0) {
        unlock_game();
        send_error(req, "token table full");
        return ESP_OK;
    }
    snprintf(game.tokens[slot].payload, sizeof(game.tokens[slot].payload),
             "buckshot:item:%s:%08lx", item_names[item], (unsigned long)esp_random());
    game.tokens[slot].item = item;
    game.tokens[slot].used = true;
    game.tokens[slot].consumed = false;
    game.tokens[slot].owner = -1;
    strlcpy(json, "{\"ok\":true,\"payload\":\"", sizeof(json));
    strlcat(json, game.tokens[slot].payload, sizeof(json));
    strlcat(json, "\"}", sizeof(json));
    save_tokens_locked();
    unlock_game();
    send_json(req, json);
    return ESP_OK;
}

static esp_err_t api_reset(httpd_req_t *req)
{
    char body[80];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    lock_game();
    if (!is_admin(pid)) {
        unlock_game();
        send_error(req, "admin only");
        return ESP_OK;
    }
    game_reset();
    unlock_game();
    send_json(req, "{\"ok\":true}");
    return ESP_OK;
}

static esp_err_t api_write_mode(httpd_req_t *req)
{
    char body[80];
    if (read_body(req, body, sizeof(body)) != ESP_OK) {
        send_error(req, "bad body");
        return ESP_OK;
    }
    int pid = param_int(body, "pid", -1);
    lock_game();
    if (!is_admin(pid) || game.phase != PHASE_LOBBY) {
        unlock_game();
        send_error(req, "admin lobby only");
        return ESP_OK;
    }
    game.nfc_write_mode = !game.nfc_write_mode;
    set_message("NFC write mode %s", game.nfc_write_mode ? "on" : "off");
    unlock_game();
    send_json(req, "{\"ok\":true}");
    return ESP_OK;
}

static const char *content_type_for(const char *path)
{
    const char *ext = strrchr(path, '.');
    if (!ext) {
        return "text/plain";
    }
    if (strcmp(ext, ".html") == 0) {
        return "text/html";
    }
    if (strcmp(ext, ".css") == 0) {
        return "text/css";
    }
    if (strcmp(ext, ".js") == 0) {
        return "application/javascript";
    }
    if (strcmp(ext, ".webmanifest") == 0) {
        return "application/manifest+json";
    }
    if (strcmp(ext, ".png") == 0) {
        return "image/png";
    }
    return "application/octet-stream";
}

static esp_err_t send_file(httpd_req_t *req, const char *path)
{
    char full[96];
    snprintf(full, sizeof(full), "/web%s", path);
    FILE *f = fopen(full, "r");
    if (!f) {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "not found");
        return ESP_OK;
    }
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_type(req, content_type_for(path));
    char chunk[512];
    size_t read;
    while ((read = fread(chunk, 1, sizeof(chunk), f)) > 0) {
        if (httpd_resp_send_chunk(req, chunk, read) != ESP_OK) {
            fclose(f);
            return ESP_FAIL;
        }
    }
    fclose(f);
    httpd_resp_send_chunk(req, NULL, 0);
    return ESP_OK;
}

static esp_err_t root_handler(httpd_req_t *req)
{
    char html[512];
    snprintf(html, sizeof(html),
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Buckshot IRL</title><body style='font-family:system-ui;background:#111;color:#eee;padding:24px'>"
        "<h1>Buckshot IRL</h1><p>Use HTTPS for Web NFC.</p>"
        "<p><a style='color:#8bd3ff' href='%s'>Open secure join page</a></p></body>",
        join_url);
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

static esp_err_t cert_handler(httpd_req_t *req)
{
    size_t cert_len = server_crt_end - server_crt_start;
    if (cert_len > 0 && server_crt_start[cert_len - 1] == '\0') {
        cert_len--;
    }
    httpd_resp_set_type(req, "application/x-x509-ca-cert");
    httpd_resp_set_hdr(req, "Content-Disposition", "attachment; filename=\"buckshot-irl.crt\"");
    httpd_resp_send(req, (const char *)server_crt_start, cert_len);
    return ESP_OK;
}

static esp_err_t http_setup_handler(httpd_req_t *req)
{
    char html[1024];
    snprintf(html, sizeof(html),
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Buckshot IRL setup</title>"
        "<body style='font-family:system-ui;background:#111;color:#eee;padding:24px;line-height:1.45'>"
        "<h1>Buckshot IRL</h1>"
        "<p>Web NFC needs HTTPS. This device uses a local self-signed certificate for 192.168.4.1.</p>"
        "<p><a style='color:#8bd3ff;font-size:20px' href='/cert'>Download certificate</a></p>"
        "<p>Install and trust the certificate for VPN and apps, then open the secure game URL.</p>"
        "<p><a style='color:#8bd3ff;font-size:20px' href='%s'>Open secure game</a></p>"
        "<p>If Chrome keeps warning, reconnect to Wi-Fi after trusting the certificate.</p>"
        "</body>",
        join_url);
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

static esp_err_t http_redirect_handler(httpd_req_t *req)
{
    char location[96];
    if (strcmp(req->uri, "/") == 0) {
        snprintf(location, sizeof(location), "https://%s/", AP_IP);
    } else {
        char uri[64];
        strlcpy(uri, req->uri, sizeof(uri));
        snprintf(location, sizeof(location), "https://%s%s", AP_IP, uri);
    }
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", location);
    httpd_resp_send(req, "HTTPS required", HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

static esp_err_t join_handler(httpd_req_t *req)
{
    if (strcmp(req->uri, join_path) != 0) {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "bad session token");
        return ESP_OK;
    }
    return send_file(req, "/index.html");
}

static esp_err_t static_handler(httpd_req_t *req)
{
    return send_file(req, req->uri);
}

static void register_get(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *))
{
    httpd_uri_t route = {.uri = uri, .method = HTTP_GET, .handler = handler};
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &route));
}

static void register_post(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *))
{
    httpd_uri_t route = {.uri = uri, .method = HTTP_POST, .handler = handler};
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &route));
}

static void register_routes(httpd_handle_t server)
{
    register_get(server, "/", root_handler);
    register_get(server, "/cert", cert_handler);
    register_get(server, "/join/*", join_handler);
    register_get(server, "/app.css", static_handler);
    register_get(server, "/app.js", static_handler);
    register_get(server, "/manifest.webmanifest", static_handler);
    register_get(server, "/fonts/*", static_handler);
    register_get(server, "/images/*", static_handler);
    register_get(server, "/api/state", api_state);
    register_post(server, "/api/register", api_register);
    register_post(server, "/api/setup", api_setup);
    register_post(server, "/api/start", api_start);
    register_post(server, "/api/arm", api_arm);
    register_post(server, "/api/item", api_item);
    register_post(server, "/api/scan", api_scan);
    register_post(server, "/api/write-token", api_write_token);
    register_post(server, "/api/write-mode", api_write_mode);
    register_post(server, "/api/reset", api_reset);
}

static void start_https_server(void)
{
    httpd_ssl_config_t config = HTTPD_SSL_CONFIG_DEFAULT();
    config.httpd.uri_match_fn = httpd_uri_match_wildcard;
    config.httpd.max_uri_handlers = 20;
    config.servercert = server_crt_start;
    config.servercert_len = server_crt_end - server_crt_start;
    config.prvtkey_pem = server_key_start;
    config.prvtkey_len = server_key_end - server_key_start;

    httpd_handle_t server = NULL;
    ESP_ERROR_CHECK(httpd_ssl_start(&server, &config));
    register_routes(server);
}

static void start_http_redirect_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.uri_match_fn = httpd_uri_match_wildcard;
    config.max_uri_handlers = 4;
    httpd_handle_t server = NULL;
    ESP_ERROR_CHECK(httpd_start(&server, &config));
    register_get(server, "/", http_setup_handler);
    register_get(server, "/cert", cert_handler);
    register_get(server, "/*", http_redirect_handler);
}

static void start_spiffs(void)
{
    esp_vfs_spiffs_conf_t conf = {
        .base_path = "/web",
        .partition_label = "web",
        .max_files = 5,
        .format_if_mount_failed = false,
    };
    ESP_ERROR_CHECK(esp_vfs_spiffs_register(&conf));
}

static void make_ids(void)
{
    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP));
    snprintf(ap_ssid, sizeof(ap_ssid), "Buckshot-%02X%02X%02X", mac[3], mac[4], mac[5]);
    snprintf(join_token, sizeof(join_token), "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
    snprintf(join_path, sizeof(join_path), "/join/%s", join_token);
}

static void start_wifi_ap(void)
{
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_ap();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    wifi_config_t wifi_config = {
        .ap = {
            .channel = AP_CHANNEL,
            .authmode = WIFI_AUTH_OPEN,
            .max_connection = AP_MAX_CLIENTS,
        },
    };
    strlcpy((char *)wifi_config.ap.ssid, ap_ssid, sizeof(wifi_config.ap.ssid));
    wifi_config.ap.ssid_len = strlen(ap_ssid);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
}

static void button_task(void *arg)
{
    gpio_config_t in_conf = {
        .pin_bit_mask = 1ULL << PIN_TRIGGER,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&in_conf));
    int stable_level = 1;
    int last_level = 1;
    TickType_t last_change = xTaskGetTickCount();
    while (true) {
        int level = gpio_get_level(PIN_TRIGGER);
        TickType_t now = xTaskGetTickCount();
        if (level != last_level) {
            last_level = level;
            last_change = now;
        }
        if (level != stable_level && (now - last_change) > pdMS_TO_TICKS(35)) {
            stable_level = level;
            if (stable_level == 0) {
                trigger_event = true;
            }
        }
        vTaskDelay(BUTTON_POLL_DELAY_TICKS);
    }
}

static void game_task(void *arg)
{
    uint32_t last_timeout_check = 0;
    while (true) {
        if (trigger_event) {
            trigger_event = false;
            lock_game();
            if (game.phase == PHASE_LOBBY) {
                game.nfc_write_mode = !game.nfc_write_mode;
                set_message("NFC write mode %s", game.nfc_write_mode ? "on" : "off");
            } else {
                resolve_shot();
            }
            unlock_game();
        }
        uint32_t now = now_ms();
        if ((uint32_t)(now - last_timeout_check) >= 500) {
            last_timeout_check = now;
            lock_game();
            cleanup_timeouts_locked();
            if (game.phase == PHASE_ACTIVE) {
                check_game_over();
            }
            unlock_game();
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

static void display_task(void *arg)
{
    uint32_t last_drawn_version = UINT32_MAX;
    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        vTaskDelay(pdMS_TO_TICKS(30));
        uint32_t version = display_version;
        if (version != last_drawn_version) {
            last_drawn_version = version;
            lcd_draw_game_screen();
        }
    }
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    game_lock = xSemaphoreCreateMutex();
    lock_game();
    game_reset();
    load_tokens_locked();
    unlock_game();
    make_ids();
    snprintf(join_url, sizeof(join_url), "https://%s%s", AP_IP, join_path);

    ESP_LOGI(TAG, "AP SSID: %s", ap_ssid);
    ESP_LOGI(TAG, "Join URL: %s", join_url);

    start_spiffs();
    lcd_init();
    start_wifi_ap();
    start_https_server();
    start_http_redirect_server();

    xTaskCreatePinnedToCore(button_task, "button", 2048, NULL, 10, NULL, 0);
    xTaskCreatePinnedToCore(game_task, "game", 4096, NULL, 8, NULL, 0);
    xTaskCreatePinnedToCore(display_task, "display", 4096, NULL, 5, &display_task_handle, 1);
    mark_display_dirty();
}
