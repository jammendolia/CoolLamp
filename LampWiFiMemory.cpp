#include <esp_wifi.h>
#include <esp_bt.h>

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

// CoolLamp advertises and accepts one phone connection; it never scans for or
// initiates connections to other devices. Do not reserve the controller's six
// default activities and large scan caches for these unused roles.
extern "C" esp_err_t __real_esp_bt_controller_init(esp_bt_controller_config_t* config);
extern "C" esp_err_t __wrap_esp_bt_controller_init(esp_bt_controller_config_t* config) {
  esp_bt_controller_config_t lamp = *config;
  lamp.ble_max_act = 2;
  lamp.normal_adv_size = 10;
  lamp.mesh_adv_size = 10;
  lamp.ble_adv_dup_filt_max = 1;
  lamp.scan_en = false;
  return __real_esp_bt_controller_init(&lamp);
}
