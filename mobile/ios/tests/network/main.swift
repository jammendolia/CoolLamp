import Foundation
import Darwin

func ipv4(_ host: String) -> Data {
    var socket = sockaddr_in()
    socket.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    socket.sin_family = sa_family_t(AF_INET)
    socket.sin_port = in_port_t(80).bigEndian
    assert(inet_pton(AF_INET, host, &socket.sin_addr) == 1)
    return withUnsafeBytes(of: &socket) { Data($0) }
}
let host = "coollamp-50b9f0.local."
assert(LampNetworkAddress.url(addresses: [ipv4("192.168.1.222")], hostname: host) == "http://192.168.1.222")
assert(LampNetworkAddress.url(addresses: [ipv4("192.168.1.220")], hostname: nil) == "http://192.168.1.220")
// Malformed or IPv6-only records must not be interpreted as IPv4 sockets.
var otherFamily = ipv4("192.168.1.222")
otherFamily[1] = UInt8(AF_INET6)
var wrongLength = ipv4("192.168.1.222")
wrongLength[0] = 0
let unusable = [Data(), Data([16]), otherFamily, wrongLength, ipv4("0.0.0.0"), ipv4("127.0.0.1")]
assert(LampNetworkAddress.url(addresses: unusable, hostname: host) == "http://coollamp-50b9f0.local")
assert(LampNetworkAddress.url(addresses: unusable + [ipv4("10.1.2.3")], hostname: host) == "http://10.1.2.3")
assert(LampNetworkAddress.url(addresses: [], hostname: nil) == nil)
assert(LampNetworkAddress.url(addresses: [], hostname: ".") == nil)
print("PASS: resolved IPv4, absent hostname, malformed sockets, family/length validation and hostname fallback")
