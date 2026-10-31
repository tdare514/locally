import SwiftUI

/// The two per-device choices at the top of the Collections screen (#352): Record player / List, and (in the record
/// player) Picture disc / Black vinyl, as slim neutral switches (`SlimSwitch`, compact, #411). Side by side when
/// they fit, else stacked; at the accessibility sizes each switch stacks its own words. Both are remembered by the
/// screen that owns the bindings.
struct CollectionsModeSwitches: View {
    @Binding var mode: CollectionsViewMode
    @Binding var record: SpinningRecord

    private static let modes: [(value: CollectionsViewMode, icon: String?, label: String)] = [
        (.player, nil, Copy.Collections.viewRecordPlayer), (.list, nil, Copy.Collections.viewList),
    ]
    private static let records: [(value: SpinningRecord, icon: String?, label: String)] = [
        (.picture, nil, Copy.Collections.pictureDisc), (.vinyl, nil, Copy.Collections.blackVinyl),
    ]

    private var modeSwitch: some View {
        SlimSwitch(options: Self.modes, selection: $mode, compact: true)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Copy.Collections.viewSwitchName)
    }

    private var recordSwitch: some View {
        SlimSwitch(options: Self.records, selection: $record, compact: true)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Copy.Collections.recordSwitchName)
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                modeSwitch
                if mode == .player { recordSwitch }
            }
            VStack(alignment: .leading, spacing: 8) {
                modeSwitch
                if mode == .player { recordSwitch }
            }
        }
    }
}
