#pragma once
#include "Arduino.h"
enum HTTPMethod { HTTP_ANY, HTTP_GET, HTTP_POST };
enum HTTPUploadStatus { UPLOAD_FILE_START, UPLOAD_FILE_WRITE, UPLOAD_FILE_END, UPLOAD_FILE_ABORTED };
struct HTTPUpload {
  HTTPUploadStatus status = UPLOAD_FILE_START;
  String filename, name, type;
  size_t totalSize = 0, currentSize = 0;
  uint8_t buf[1436] = {};
};
