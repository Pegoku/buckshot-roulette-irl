idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    EMBED_TXTFILES
        "../certs/server.crt"
        "../certs/server.key"
    REQUIRES
        esp_driver_gpio
        esp_driver_spi
        esp_event
        esp_http_server
        esp_https_server
        esp_netif
        esp_wifi
        nvs_flash
        qrcode
        spiffs
)
