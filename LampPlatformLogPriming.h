#pragma once

#include <unistd.h>

#if defined(ESP32)
#include <sdkconfig.h>
#if CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG || CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG
#include <driver/usb_serial_jtag_vfs.h>
#endif
#endif

// Call once during setup, before audio, network, Bluetooth, or lamp persistence.
// Arduino 3.3.11 / ESP-IDF 5.5.5 (b774170ff46) lazily allocates the UART VFS
// write mutex. Its first allocation can abort during an SDK out-of-memory log.
// The pinned public POSIX write path dispatches even an empty write; UART VFS
// acquires its lock before checking the byte count, so no characters are sent.
// Empty printf/fflush calls do not guarantee that this VFS path is reached.
//
// The secondary USB VFS skips writes without a connected host. Its public
// use_nonblocking API initializes both locks and selects its existing default
// callbacks, independently of host presence. This does not reconfigure Arduino
// HWCDC, the USB driver, or the shared radio. Priming consumes persistent mutex
// memory; it prevents this lazy-lock abort, not the underlying heap shortage.
// Primary source: espressif/esp-idf@b774170ff46, components/{vfs/vfs.c,
// esp_vfs_console/vfs_console.c, esp_driver_uart/src/uart_vfs.c,
// esp_driver_usb_serial_jtag/src/usb_serial_jtag_vfs.c,newlib/src/locks.c}.
inline bool primeLampPlatformLogLocks() {
#if defined(ESP32) && (CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG || CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG)
  usb_serial_jtag_vfs_use_nonblocking();
#endif
  const ssize_t stdoutResult = ::write(STDOUT_FILENO, "", 0);
  const ssize_t stderrResult = ::write(STDERR_FILENO, "", 0);
  return stdoutResult == 0 && stderrResult == 0;
}
