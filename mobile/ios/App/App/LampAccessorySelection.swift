import Foundation

// AccessorySetupKit can deliver a provisional accessory before its final
// Bluetooth identifier/name. Keep selection separate from the GATT handshake.
struct LampAccessoryRecord {
    let id: UUID?
    let name: String
}
struct LampAccessorySelection {
    private(set) var knownIDs: Set<UUID> = []
    private(set) var candidate: LampAccessoryRecord?
    mutating func begin(knownIDs: Set<UUID>) { self.knownIDs = knownIDs; candidate = nil }
    mutating func added(_ record: LampAccessoryRecord) { candidate = record }
    mutating func changed(_ record: LampAccessoryRecord) {
        guard let id = record.id, let candidate = candidate else { return }
        if candidate.id == id || (candidate.id == nil && !knownIDs.contains(id)) { self.candidate = record }
    }
    func resolve(_ inventory: [LampAccessoryRecord]) -> LampAccessoryRecord? {
        if let record = candidate, let id = record.id {
            return inventory.first(where: { $0.id == id }) ?? record
        }
        let new = inventory.filter { record in record.id.map { !knownIDs.contains($0) } ?? false }
        return new.count == 1 ? new[0] : nil
    }
}
