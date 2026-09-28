import CryptoKit
import Foundation

/// Content hashing for sync's `coverHash` change signal (`spec/sync.md`),
/// added with `syncVersion` 2. This is the app's first `CryptoKit` use; it
/// needs no entitlement, only the import.
extension Data {
    /// Lowercase hex sha256 of this data's bytes.
    var sha256Hex: String {
        SHA256.hash(data: self).map { String(format: "%02x", $0) }.joined()
    }
}
