import Foundation

let valid = Data(repeating: 0, count: 512).base64EncodedString()
precondition(LampFirmwareDigest.sha256(valid) == "076a27c79e5ace2a3d47f9dd2e83e4ff6ea8872b3c2218f66c92b89b55f36560")
precondition(LampFirmwareDigest.sha256("invalid!") == nil)
precondition(LampFirmwareDigest.sha256(Data(repeating: 0, count: 287).base64EncodedString()) == nil)
precondition(LampFirmwareDigest.sha256(Data(repeating: 0, count: 2_031_617).base64EncodedString()) == nil)
print("PASS: native firmware digest and image bounds")
