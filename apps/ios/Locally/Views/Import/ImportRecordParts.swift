import SwiftUI

/// What the single and album records share with `ImportView` (#205): the beat driver, the
/// Single / Album switch, the cover picker's Files hand-off and the actions that open pickers or
/// send. `ImportView` builds one per render.
struct ImportRecordContext {
    let driver: ImportBeatDriver
    let kind: Binding<ImportKind>
    let rawCoverPick: Binding<Data?>
    /// Bumped on a successful send to play the sleeve ceremony.
    let ceremony: Int
    /// True from the Send tap until the ceremony has played.
    let isSendHeld: Bool
    /// True while either model is staging files, reading tags or sending: the kind switch is off.
    let isBusy: Bool
    let onAddTrack: () -> Void
    let onPickCoverFromFiles: () -> Void
    let onSend: () -> Void
}

/// The sleeve at the top of the record. It draws the driver's frame through a `TimelineView`
/// that is paused whenever nothing is moving, and wraps the cover binding so only a cover the
/// user chooses (Files, Photos, a recent cover) or removes reaches the beat.
struct ImportRecordSleeve: View {
    @Binding var coverData: Data?
    let context: ImportRecordContext

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let driver = context.driver
        TimelineView(.animation(minimumInterval: nil, paused: !driver.isAnimating)) { timeline in
            SleeveCoverPicker(
                imageData: Binding(
                    get: { coverData },
                    set: { newValue in
                        coverData = newValue
                        driver.coverChanged(newValue, reduced: reduceMotion)
                    }
                ),
                rawPick: context.rawCoverPick,
                ceremony: context.ceremony,
                onPickFromFiles: context.onPickCoverFromFiles,
                beat: driver.frame(at: timeline.date, reduced: reduceMotion)
            )
        }
        // Room inside the row for the sleeve's shadow, which the row would otherwise clip.
        .padding(.top, Theme.Immersive.sleeveShadowRoomTop)
        .padding(.bottom, Theme.Immersive.sleeveShadowRoomBottom)
    }
}

/// The meta line under the sleeve: the Single / Album switch and the track count.
struct ImportMetaLine: View {
    @Binding var kind: ImportKind
    let trackCount: Int
    /// Dims and disables the switch (VoiceOver reads it as dimmed).
    var isSwitchDisabled: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Immersive.dockGap) {
            SegmentedPill(
                options: [(ImportKind.single, Copy.Import.kindSingle), (ImportKind.album, Copy.Import.kindAlbum)],
                selection: $kind
            )
            .disabled(isSwitchDisabled)
            Spacer(minLength: 0)
            Text(Copy.Library.trackCount(trackCount))
                .font(Theme.ScaledFont.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.trailing)
        }
    }
}

extension View {
    /// A sleeve or field row: no fill, no separator, no side inset (as on the release page).
    func importClearRow(top: CGFloat = 0, bottom: CGFloat = 0) -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: top, leading: 0, bottom: bottom, trailing: 0))
    }

    /// A row of the tracks panel, in the release page's faked glass.
    func importPanelRow(_ edge: PanelEdge) -> some View {
        listRowBackground(PanelRowBackground(edge: edge))
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(
                top: Theme.Spacing.rowGap,
                leading: Theme.Immersive.panelRowInset,
                bottom: Theme.Spacing.rowGap,
                trailing: Theme.Immersive.panelRowInset
            ))
    }

    /// The record's list: the release page's style, and a tap anywhere mid-beat skips to the end
    /// while still doing its job. Out of the beat the gesture is off (`.subviews`), so reorder and
    /// swipe to delete are untouched.
    func importRecordList(driver: ImportBeatDriver) -> some View {
        listStyle(.insetGrouped)
            .listSectionSpacing(.custom(Theme.Spacing.editorSectionGap))
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
            .simultaneousGesture(
                TapGesture().onEnded { driver.skip() },
                including: driver.isPlaying ? .all : .subviews
            )
    }
}

/// The tracks panel's heading row and its closing Add a track button.
struct ImportTracksHeader: View {
    var body: some View {
        Text(Copy.Import.tracks)
            .font(Theme.ScaledFont.headline)
            .foregroundStyle(Theme.primaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

struct ImportAddTrackButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(Copy.Import.addTrack)
        }
        .buttonStyle(TextButtonStyle(color: Theme.accent))
        .frame(maxWidth: .infinity, minHeight: Theme.Immersive.panelActionMinHeight, alignment: .leading)
    }
}
