#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

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

#define COLOR_BLACK 0x0000
#define COLOR_WHITE 0xffff
#define COLOR_RED 0xf800
#define COLOR_GREEN 0x07e0
#define COLOR_BLUE 0x001f
#define COLOR_YELLOW 0xffe0
#define COLOR_CYAN 0x07ff
#define COLOR_MAGENTA 0xf81f
#define BUTTON_POLL_DELAY_TICKS 1

static const char *TAG = "mvp";

static spi_device_handle_t lcd_spi;
static volatile uint32_t trigger_count;
static char ap_ssid[32];
static char join_token[17];
static char join_path[32];

static const uint8_t digit_font[10][5] = {
    {0x7, 0x5, 0x5, 0x5, 0x7},
    {0x2, 0x6, 0x2, 0x2, 0x7},
    {0x7, 0x1, 0x7, 0x4, 0x7},
    {0x7, 0x1, 0x7, 0x1, 0x7},
    {0x5, 0x5, 0x7, 0x1, 0x1},
    {0x7, 0x4, 0x7, 0x1, 0x7},
    {0x7, 0x4, 0x7, 0x5, 0x7},
    {0x7, 0x1, 0x1, 0x2, 0x2},
    {0x7, 0x5, 0x7, 0x5, 0x7},
    {0x7, 0x5, 0x7, 0x1, 0x7},
};

static void lcd_cmd(uint8_t cmd)
{
    spi_transaction_t t = {
        .length = 8,
        .tx_buffer = &cmd,
    };
    gpio_set_level(PIN_LCD_DC, 0);
    ESP_ERROR_CHECK(spi_device_polling_transmit(lcd_spi, &t));
}

static void lcd_data(const void *data, int len)
{
    if (len == 0) {
        return;
    }
    spi_transaction_t t = {
        .length = len * 8,
        .tx_buffer = data,
    };
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
    if (x >= LCD_WIDTH || y >= LCD_HEIGHT) {
        return;
    }
    if (x + w > LCD_WIDTH) {
        w = LCD_WIDTH - x;
    }
    if (y + h > LCD_HEIGHT) {
        h = LCD_HEIGHT - y;
    }

    static uint16_t line[LCD_WIDTH];
    uint16_t swapped = (color << 8) | (color >> 8);
    for (int i = 0; i < w; i++) {
        line[i] = swapped;
    }

    lcd_set_window(x, y, x + w - 1, y + h - 1);
    gpio_set_level(PIN_LCD_DC, 1);
    for (int row = 0; row < h; row++) {
        spi_transaction_t t = {
            .length = w * 16,
            .tx_buffer = line,
        };
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

static void lcd_draw_test_screen(void)
{
    uint32_t count = trigger_count;
    uint16_t colors[] = {COLOR_RED, COLOR_YELLOW, COLOR_GREEN, COLOR_CYAN, COLOR_BLUE, COLOR_MAGENTA};

    lcd_fill_rect(0, 0, LCD_WIDTH, LCD_HEIGHT, COLOR_BLACK);

    for (int i = 0; i < 6; i++) {
        lcd_fill_rect(i * (LCD_WIDTH / 6), 0, LCD_WIDTH / 6, 34, colors[i]);
    }

    lcd_fill_rect(16, 54, 288, 4, COLOR_WHITE);
    lcd_fill_rect(16, 182, 288, 4, COLOR_WHITE);
    lcd_draw_number(24, 78, count, COLOR_WHITE, 16);

    uint16_t state_color = (count % 2 == 0) ? COLOR_GREEN : COLOR_RED;
    lcd_fill_rect(232, 78, 56, 80, state_color);
    lcd_fill_rect(240, 86, 40, 64, COLOR_BLACK);
    lcd_fill_rect(248, 94, 24, 48, state_color);

    for (int i = 0; i < 16; i++) {
        uint16_t bit_color = (join_token[i] >= '8' || (join_token[i] >= 'a' && join_token[i] <= 'f')) ? COLOR_WHITE : COLOR_BLUE;
        lcd_fill_rect(18 + i * 18, 202, 12, 20, bit_color);
    }
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

    lcd_draw_test_screen();
}

static void button_task(void *arg)
{
    gpio_config_t in_conf = {
        .pin_bit_mask = 1ULL << PIN_TRIGGER,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
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
                trigger_count++;
                ESP_LOGI(TAG, "trigger pressed, count=%lu", (unsigned long)trigger_count);
            }
        }
        vTaskDelay(BUTTON_POLL_DELAY_TICKS);
    }
}

static void display_task(void *arg)
{
    uint32_t last_count = UINT32_MAX;
    while (true) {
        if (trigger_count != last_count) {
            last_count = trigger_count;
            lcd_draw_test_screen();
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

static void make_ids(void)
{
    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP));
    snprintf(ap_ssid, sizeof(ap_ssid), "Buckshot-%02X%02X%02X", mac[3], mac[4], mac[5]);

    uint32_t a = esp_random();
    uint32_t b = esp_random();
    snprintf(join_token, sizeof(join_token), "%08lx%08lx", (unsigned long)a, (unsigned long)b);
    snprintf(join_path, sizeof(join_path), "/join/%s", join_token);
}

static esp_err_t root_handler(httpd_req_t *req)
{
    const char *html =
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Buckshot MVP</title>"
        "<style>body{font-family:system-ui;margin:24px;background:#111;color:#eee}"
        "a,button{font-size:20px}code{background:#222;padding:2px 6px}</style>"
        "<h1>Buckshot MVP</h1>"
        "<p>This root page proves the ESP32 web server is alive.</p>"
        "<p>The playable test page is gated behind the URL shown over serial and encoded on the display test bars.</p>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t status_handler(httpd_req_t *req)
{
    char json[160];
    snprintf(json, sizeof(json),
             "{\"ssid\":\"%s\",\"ip\":\"%s\",\"join\":\"%s\",\"trigger_count\":%lu}\n",
             ap_ssid, AP_IP, join_path, (unsigned long)trigger_count);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t join_handler(httpd_req_t *req)
{
    if (strcmp(req->uri, join_path) != 0) {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "Bad session token");
        return ESP_OK;
    }

    char html[1800];
    snprintf(html, sizeof(html),
             "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
             "<title>Buckshot MVP</title>"
             "<style>"
             "body{font-family:system-ui;margin:0;background:#101014;color:#f4f4f5}"
             "main{max-width:640px;margin:auto;padding:24px}"
             ".panel{border:1px solid #33363f;padding:16px;border-radius:8px;background:#18191f}"
             "button{font-size:18px;padding:10px 14px;margin:6px 0}"
             "code{background:#272933;padding:2px 6px;border-radius:4px}"
             "</style><main><h1>Buckshot MVP</h1>"
             "<div class=panel><p>AP: <code>%s</code></p>"
             "<p>Session: <code>%s</code></p>"
             "<p>Trigger count: <strong id=count>%lu</strong></p>"
             "<button onclick=refreshStatus()>Refresh status</button></div>"
             "<h2>Web NFC smoke test</h2>"
             "<div class=panel><p id=nfc>NFC not started.</p>"
             "<button onclick=scanNfc()>Scan NFC tag</button><br>"
             "<button onclick=writeNfc()>Write test item tag</button></div>"
             "<script>"
             "async function refreshStatus(){const r=await fetch('/status');const s=await r.json();count.textContent=s.trigger_count}"
             "setInterval(refreshStatus,1000);"
             "async function scanNfc(){try{if(!('NDEFReader'in window)){nfc.textContent='Web NFC is not available in this browser';return}"
             "const reader=new NDEFReader();await reader.scan();nfc.textContent='Tap a tag now';"
             "reader.onreading=e=>{let out='Tag serial: '+e.serialNumber;for(const record of e.message.records){out+=' | '+record.recordType}"
             "}nfc.textContent=out};}catch(e){nfc.textContent=e.name+': '+e.message}}"
             "async function writeNfc(){try{if(!('NDEFReader'in window)){nfc.textContent='Web NFC is not available in this browser';return}"
             "const writer=new NDEFReader();await writer.write({records:[{recordType:'text',data:'buckshot:item:test'}]});"
             "nfc.textContent='Wrote test item payload';}catch(e){nfc.textContent=e.name+': '+e.message}}"
             "</script></main>",
             ap_ssid, join_path, (unsigned long)trigger_count);

    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

static void start_webserver(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.uri_match_fn = httpd_uri_match_wildcard;

    httpd_handle_t server = NULL;
    ESP_ERROR_CHECK(httpd_start(&server, &config));

    httpd_uri_t root = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_handler,
    };
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &root));

    httpd_uri_t status = {
        .uri = "/status",
        .method = HTTP_GET,
        .handler = status_handler,
    };
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &status));

    httpd_uri_t join = {
        .uri = "/join/*",
        .method = HTTP_GET,
        .handler = join_handler,
    };
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &join));
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
            .ssid_len = strlen(ap_ssid),
            .channel = AP_CHANNEL,
            .authmode = WIFI_AUTH_OPEN,
            .max_connection = AP_MAX_CLIENTS,
        },
    };
    strlcpy((char *)wifi_config.ap.ssid, ap_ssid, sizeof(wifi_config.ap.ssid));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    make_ids();
    ESP_LOGI(TAG, "AP SSID: %s", ap_ssid);
    ESP_LOGI(TAG, "Join URL: http://%s%s", AP_IP, join_path);

    lcd_init();
    start_wifi_ap();
    start_webserver();

    xTaskCreatePinnedToCore(button_task, "button", 2048, NULL, 10, NULL, 0);
    xTaskCreatePinnedToCore(display_task, "display", 4096, NULL, 5, NULL, 1);
}
