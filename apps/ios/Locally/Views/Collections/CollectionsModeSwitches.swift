import SwiftUI

/// The two per-device choices at the top of the Collections screen (#352): Record player / List, and (in the record
/// player) Picture disc / Black vinyl, as house glass switches (`GlowSwitch`, compact) whose thumbs take the cover's
/// colour (#363). Side by side when they fit, else stacked; at the accessibility sizes each switch stacks its own
/// words. Both are remembered by the screen that owns the bindings.
struct CollectionsModeSwitches: View {
    @Binding var mode: CollectionsViewMode
    @Binding var record: SpinningRecord
    /// The thumbs' colour: the front cover's, else the accent.
    var tint: Color = Theme.accent

    private static let modes: [(value: CollectionsViewMode, icon: String?, label: String)] = [
        (.player, nil, Copy.Collections.viewRecordPlayer), (.list, nil, Copy.Collections.viewList),
    ]
    private static let records: [(value: SpinningRecord, icon: String?, label: String)] = [
        (.picture, nil, Copy.Collections.pictureDisc), (.vinyl, nil, Copy.Collections.blackVinyl),
    ]

    private var modeSwitch: some View {
        GlowSwitch(options: Self.modes, selection: $mode, tint: tint, compact: true)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Copy.Collections.viewSwitchName)
    }

    private var recordSwitch: some View {
        GlowSwitch(options: Self.records, selection: $record, tint: tint, compact: true)
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
