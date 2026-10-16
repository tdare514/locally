import SwiftUI

/// What the single and album records share with `ImportView` (#205): the beat driver, the
/// Single / Album switch, the cover picker's Files hand-off and the actions that open pickers or
/// send. `ImportView` builds one per render.
struct ImportRecordContext {
    let driver: ImportBeatDriver
    let kind: Binding<ImportKind>
    let rawCoverPick: Binding<Data?>
    /// Bumped by Send to scroll the record back to the sleeve.
    let sleeveScrollRequest: Int
    /// True from the Send tap until the Sent card has closed or the send has failed.
    let isSendHeld: Bool
    /// True while either model is staging files, reading tags or sending: the kind switch is off.
    let isBusy: Bool
    let onAddTrack: () -> Void
    /// Opens Files for one audio file to swap in at this album row.
    let onReplaceTrack: (UUID) -> Void
    let onPickCoverFromFiles: () -> Void
    let onSend: () -> Void
    /// The cover's two glow colours (accent and violet with no cover): the kind switch's tint and Send.
    let glowColors: [Color]
}

/// The sleeve at the top of the record. It draws the driver's frame through a `TimelineView`
/// that is paused whenever nothing is moving (no beat playing, no seal or unseal running), and wraps the cover binding so only a cover the
/// user chooses (Files, Photos, a recent cover) or removes reaches the beat.
struct ImportRecordSleeve: View {
    @Binding var coverData: Data?
    let context: ImportRecordContext

    /// The scroll anchor Send uses to bring the sleeve into view.
    static let scrollID = "import-record-sleeve"

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
                onPickFromFiles: context.onPickCoverFromFiles,
                beat: driver.frame(at: timeline.date, reduced: reduceMotion)
            )
        }
        // Identifiers are not spoken; they let a UI test tell when the beat is playing.
        .accessibilityIdentifier(driver.isPlaying ? "sleeve-beat-playing" : "sleeve-beat-rest")
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
    /// The switch's thumb colour.
    let tint: Color

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        // At the accessibility sizes the switch takes its own line, so its words never squeeze.
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: Theme.Immersive.dockGap) {
                kindSwitch
                count
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Immersive.dockGap) {
                kindSwitch
                Spacer(minLength: 0)
                count.multilineTextAlignment(.trailing)
            }
        }
    }

    private var kindSwitch: some View {
        KindSwitch(kind: $kind, tint: tint).disabled(isSwitchDisabled)
    }

    private var count: some View {
        Text(Copy.Library.trackCount(trackCount))
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(Theme.secondaryText)
    }
}

extension View {
    /// A sleeve or field row: no fill, no separator, no side inset (as on the release page).
    func importClearRow(top: CGFloat = 0, bottom: CGFloat = 0) -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(
                top: top,
                leading: Theme.Immersive.recordRowSideInset,
                bottom: bottom,
                trailing: Theme.Immersive.recordRowSideInset
            ))
    }

    /// A row of inline fields. The list's cell clips at its edge and the round first letters of a
    /// field (G, S, C, O) overshoot to the left of the text, so the row is inset by a little that
    /// scales with Dynamic Type (the overshoot does).
    func importFieldsRow() -> some View {
        modifier(ImportFieldsRow())
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

    /// A `TrackRow` in the tracks panel: the panel row with the Mac's hairline below it, from the
    /// number's leading edge. There is none above the first track or below the last (`isFirst`,
    /// `isLast`), and a disc heading next to a row counts as the edge of its run.
    func importTrackRow(isFirst: Bool, isLast: Bool) -> some View {
        alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            .listRowBackground(PanelRowBackground(edge: .middle))
            .listRowSeparator(isFirst ? .hidden : .visible, edges: .top)
            .listRowSeparator(isLast ? .hidden : .visible, edges: .bottom)
            .listRowSeparatorTint(Theme.Track.separatorTint)
            .listRowInsets(EdgeInsets(
                top: 0,
                leading: Theme.Immersive.panelRowInset,
                bottom: 0,
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

/// A failed send's message, in the footer just above Send. It sits on a soft dark halo (a blurred
/// shape, not a backdrop blur) so the list scrolling under the footer never shows through the red
/// text, and it is capped in height so Send stays on screen at the largest text sizes with the
/// keyboard up; VoiceOver still reads the whole message.
struct ImportSendError: View {
    let message: String

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var cappedHeight: CGFloat = 0
    @State private var fullHeight: CGFloat = 0
    @State private var showsDetails = false

    /// True when the line cap really cut the message short: the unconstrained text is taller.
    private var isTruncated: Bool { fullHeight - cappedHeight > 1 }

    private var messageText: Text {
        Text(message)
    }

    var body: some View {
        VStack(spacing: 0) {
            messageText
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.danger)
                .multilineTextAlignment(.center)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? Theme.Import.sendErrorLinesLarge : Theme.Import.sendErrorLines)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cappedHeight = $0 }
                .background {
                    // A hidden copy with no line cap, to compare heights against.
                    messageText
                        .font(Theme.ScaledFont.caption)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .hidden()
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
                }
                .accessibilityLabel(message)
            if isTruncated {
                // Scaled with the message (`TextButtonStyle` is a fixed size), underlined as the
                // Mac's secondary actions are.
                Button { showsDetails = true } label: {
                    Text(Copy.Import.sendErrorDetails)
                        .font(Theme.ScaledFont.caption.weight(.semibold))
                        .underline()
                        .foregroundStyle(Theme.primaryText)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Import.sendErrorHaloInset)
        .background {
            RoundedRectangle(cornerRadius: Theme.Import.sendErrorHaloInset * 2)
                .fill(Theme.background.opacity(Theme.Import.sendErrorHaloOpacity))
                .blur(radius: Theme.Import.sendErrorHaloInset)
                .allowsHitTesting(false)
        }
        .padding(.bottom, Theme.Spacing.rowGap)
        .sheet(isPresented: $showsDetails) {
            ImportSendErrorDetails(message: message)
        }
    }
}

/// The whole failed-send message, for when the footer's capped copy cuts it short.
private struct ImportSendErrorDetails: View {
    let message: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(message)
                    .font(Theme.ScaledFont.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Theme.Spacing.pagePadding)
            }
            .navigationTitle(Copy.Import.sendErrorTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Copy.Cover.done) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.card)
    }
}

/// `importFieldsRow()`: clear, no separator, and a leading inset of `inlineFieldOvershoot` that grows with text size.
private struct ImportFieldsRow: ViewModifier {
    @ScaledMetric(relativeTo: .largeTitle) private var overshoot = Theme.Immersive.inlineFieldOvershoot

    func body(content: Content) -> some View {
        content
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(
                top: 0,
                leading: Theme.Immersive.recordRowSideInset + overshoot,
                bottom: 0,
                trailing: Theme.Immersive.recordRowSideInset
            ))
    }
}

/// The quiet note under the Single / Album switch on the album record: faked glass, never blocking.
/// Fades in and rises 6 pt when it appears; Reduce Motion: the fade only.
struct AlbumNotice: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Immersive.albumNoticeIconGap) {
            Image(systemName: "info.circle")
                .accessibilityHidden(true)
            Text(Copy.Import.albumNotice)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(Theme.ScaledFont.caption)
        .foregroundStyle(Theme.secondaryText)
        .padding(Theme.Immersive.albumNoticePadding)
        .background(Theme.Immersive.panelFill, in: RoundedRectangle(cornerRadius: Theme.Immersive.albumNoticeRadius, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Copy.Import.albumNotice)
        .opacity(shown ? 1 : 0)
        .offset(y: shown || reduceMotion ? 0 : Theme.Immersive.albumNoticeRise)
        .onAppear {
            withAnimation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Immersive.albumNoticeDuration)) {
                shown = true
            }
        }
    }
}
