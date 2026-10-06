import Foundation

let a = UUID(uuidString: "AAAAAAAA-0000-0000-0000-000000000001")!
let b = UUID(uuidString: "BBBBBBBB-0000-0000-0000-000000000002")!
let c = UUID(uuidString: "CCCCCCCC-0000-0000-0000-000000000003")!
var selection = LampAccessorySelection()
selection.begin(knownIDs: [b])
selection.added(LampAccessoryRecord(id: nil, name: "CoolLamp"))
assert(selection.resolve([LampAccessoryRecord(id: b, name: "Other lamp")]) == nil)
selection.changed(LampAccessoryRecord(id: b, name: "Unrelated rename"))
assert(selection.candidate?.id == nil)
selection.changed(LampAccessoryRecord(id: a, name: "My new helix"))
assert(selection.resolve([])?.id == a)
assert(selection.resolve([])?.name == "My new helix")
// The final session snapshot has the most recent name after Apple's rename UI.
assert(selection.resolve([LampAccessoryRecord(id: a, name: "Final name")])?.name == "Final name")
selection.begin(knownIDs: [b])
assert(selection.resolve([LampAccessoryRecord(id: a, name: "Late addition"), LampAccessoryRecord(id: b, name: "Other")])?.id == a)
// Do not pick an arbitrary accessory if more than one new device is present.
assert(selection.resolve([LampAccessoryRecord(id: a, name: "A"), LampAccessoryRecord(id: c, name: "C")]) == nil)
selection.begin(knownIDs: [a, b])
selection.added(LampAccessoryRecord(id: a, name: "Already authorized"))
assert(selection.resolve([LampAccessoryRecord(id: a, name: "Existing selection")])?.id == a)
selection.begin(knownIDs: [a, b])
assert(selection.candidate == nil && selection.resolve([LampAccessoryRecord(id: a, name: "A")]) == nil)
print("PASS: provisional IDs, rename updates, delayed inventory, existing selection, unrelated events, ambiguity and cancellation")
