#include <esp_wifi.h>

// Arduino's default Wi-Fi pools leave too little RAM for an RSA-authenticated
// TLS download alongside Bluetooth. This lamp needs modest throughput, so use
// smaller supported pools. Applied by the release build's linker wrapper.
extern "C" esp_err_t __real_esp_wifi_init(const wifi_init_config_t* config);
extern "C" esp_err_t __wrap_esp_wifi_init(const wifi_init_config_t* config) {
  wifi_init_config_t lamp = *config;
  lamp.static_rx_buf_num = 2;
  lamp.dynamic_rx_buf_num = 8;
  lamp.dynamic_tx_buf_num = 8;
  lamp.rx_ba_win = 2;
  lamp.rx_mgmt_buf_num = 2;
  lamp.mgmt_sbuf_num = 6;
  return __real_esp_wifi_init(&lamp);
}
