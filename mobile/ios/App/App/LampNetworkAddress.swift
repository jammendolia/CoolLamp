import Foundation
import Darwin

// NetService has already resolved these socket addresses. Use that result for
// HTTP instead of making every request depend on another multicast DNS lookup.
enum LampNetworkAddress {
    static func url(addresses: [Data], hostname: String?) -> String? {
        for data in addresses {
            var socket = sockaddr_in()
            let size = MemoryLayout<sockaddr_in>.size
            guard data.count >= size else { continue }
            _ = withUnsafeMutableBytes(of: &socket) { data.copyBytes(to: $0, count: size) }
            guard socket.sin_family == sa_family_t(AF_INET), Int(socket.sin_len) == size else { continue }
            var address = socket.sin_addr
            var output = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &address, &output, socklen_t(output.count)) != nil else { continue }
            let host = String(cString: output)
            guard host != "0.0.0.0", !host.hasPrefix("127.") else { continue }
            return "http://" + host
        }
        guard let host = hostname?.trimmingCharacters(in: CharacterSet(charactersIn: ".")), !host.isEmpty else { return nil }
        return "http://" + host
    }
}
