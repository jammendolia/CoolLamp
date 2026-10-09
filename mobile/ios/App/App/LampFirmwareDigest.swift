import Foundation
import CryptoKit

enum LampFirmwareDigest {
    static func sha256(_ encoded: String) -> String? {
        guard encoded.utf8.count <= 2_708_824,
              let bytes = Data(base64Encoded: encoded),
              bytes.count >= 288, bytes.count <= 2_031_616 else { return nil }
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}
