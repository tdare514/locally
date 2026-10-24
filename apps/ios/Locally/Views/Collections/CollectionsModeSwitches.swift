import SwiftUI

/// The two per-device choices at the top of the Collections screen (#352): Record player / List, and (in the record
/// player) Picture disc / Black vinyl, as one row of plain words with a dot under the chosen one and a thin divider
/// between the groups. The row drops to two lines only when it doesn't fit. Both are remembered by the screen that
/// owns the bindings.
struct CollectionsModeSwitches: View {
    @Binding var mode: CollectionsViewMode
    @Binding var record: SpinningRecord

    private static let modes: [(value: CollectionsViewMode, label: String)] = [
        (.player, Copy.Collections.viewRecordPlayer), (.list, Copy.Collections.viewList),
    ]
    private static let records: [(value: SpinningRecord, label: String)] = [
        (.picture, Copy.Collections.pictureDisc), (.vinyl, Copy.Collections.blackVinyl),
    ]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                DotSwitch(name: Copy.Collections.viewSwitchName, options: Self.modes, selection: $mode)
                if mode == .player {
                    Rectangle().fill(Color.white.opacity(0.2)).frame(width: 1, height: 22).accessibilityHidden(true)
                    DotSwitch(name: Copy.Collections.recordSwitchName, options: Self.records, selection: $record)
                }
            }
            VStack(alignment: .leading, spacing: 0) {
                DotSwitch(name: Copy.Collections.viewSwitchName, options: Self.modes, selection: $mode)
                if mode == .player {
                    DotSwitch(name: Copy.Collections.recordSwitchName, options: Self.records, selection: $record)
                }
            }
        }
        .padding(.horizontal, -6)
    }
}
