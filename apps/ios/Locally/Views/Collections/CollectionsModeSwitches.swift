import SwiftUI

/// The two per-device choices at the top of the Collections screen (#352): Record player / List, and (in the record
/// player) Picture disc / Black vinyl. Both are remembered in `UserDefaults` by the screen that owns the bindings.
struct CollectionsModeSwitches: View {
    @Binding var mode: CollectionsViewMode
    @Binding var record: SpinningRecord

    private static let modes: [(value: CollectionsViewMode, icon: String?, label: String)] = [
        (.player, nil, Copy.Collections.viewRecordPlayer), (.list, nil, Copy.Collections.viewList),
    ]
    private static let records: [(value: SpinningRecord, icon: String?, label: String)] = [
        (.picture, nil, Copy.Collections.pictureDisc), (.vinyl, nil, Copy.Collections.blackVinyl),
    ]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { switches }
            VStack(alignment: .leading, spacing: 8) { switches }
        }
    }

    @ViewBuilder
    private var switches: some View {
        GlowSwitch(options: Self.modes, selection: $mode, tint: Theme.accent, compact: true)
        if mode == .player {
            GlowSwitch(options: Self.records, selection: $record, tint: Theme.accent, compact: true)
        }
    }
}
