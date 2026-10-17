import SwiftUI

/// A track row, after the Mac's `TrackList` row: the number, the title (an inline field or plain
/// text), then at the trailing edge the plays, a replace button and the drag grip. Every piece is
/// optional, so the single, the album and the release page share it. It draws no background of
/// its own; it sits inside a panel that supplies the fill and the hairlines.
struct TrackRow: View {
    var number: Int?
    let title: String
    /// The track's featured artists (#287), shown dimmed after the title as "feat. B & C".
    var featuring: [String] = []
    /// Set where the names can be edited (an album's rows): the feat. button opens their sheet.
    var onFeat: (() -> Void)?
    /// Set for an editable title (an album's); nil shows the title as plain text.
    var titleBinding: Binding<String>?
    var plays: String?
    /// The track's length (`m:ss`) and the same in words for VoiceOver; left out when unknown.
    var length: String?
    var lengthSpoken: String?
    var onReplace: (() -> Void)?
    var showsGrip = false
    /// The disc menu on the number (#222); nil or empty keeps a plain number.
    var discActions: DiscNumbering.Actions?
    var onStartDisc: (() -> Void)?
    var onJoinDisc: (() -> Void)?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric private var numberWidth = Theme.Track.numberWidth

    var body: some View {
        HStack(spacing: Theme.Track.spacing) {
            // The number sits on the title's baseline, as on the Mac, not centred against the field.
            HStack(alignment: .firstTextBaseline, spacing: Theme.Track.spacing) {
                if let number {
                    if let discActions, !discActions.isEmpty {
                        discMenu(number: number, actions: discActions)
                    } else {
                        numberText(number)
                            // A fixed column keeps the titles in line; at the accessibility sizes the
                            // number takes only its own width, so the title keeps the room.
                            .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : numberWidth, alignment: .leading)
                            .fixedSize()
                    }
                }
                if dynamicTypeSize.isAccessibilitySize {
                    // At the accessibility sizes the plays sit under the title, so neither is squeezed.
                    VStack(alignment: .leading, spacing: 2) {
                        titleView
                        playsView
                    }
                } else {
                    titleView
                    playsView
                }
            }
            lengthView
            if let onFeat {
                Button(action: onFeat) {
                    Text(Copy.Featuring.button)
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.Tint.accentText)
                        .lineLimit(1)
                        .fixedSize()
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.Featuring.buttonLabel(track: title))
                .accessibilityIdentifier("feat-button")
            }
            if let onReplace {
                Button(action: onReplace) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(.white.opacity(Theme.Track.replaceOpacity))
                        .frame(width: Theme.Track.replaceHitSize, height: Theme.Track.replaceHitSize)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.Import.replaceTrack(title))
            }
            if showsGrip {
                Image(systemName: "line.3.horizontal")
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(.white.opacity(Theme.Track.gripOpacity))
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: Theme.Track.minHeight)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(number.map { "track-row-\($0)" } ?? "track-row")
    }

    private func numberText(_ number: Int) -> some View {
        Text("\(number)")
            .font(Theme.ScaledFont.trackNumber)
            .foregroundStyle(.white.opacity(Theme.Track.numberOpacity))
    }

    /// The number as a menu button (#222): the number and a small chevron in the same font and colour,
    /// a 44 pt hit target that reaches into the row's inset and the gap before the title so the
    /// column keeps its width, and the same two actions for VoiceOver.
    private func discMenu(number: Int, actions: DiscNumbering.Actions) -> some View {
        let hit = Theme.Track.discMenuHitSize
        let reach = (hit - numberWidth) / 2
        return Menu {
            if let start = actions.start {
                Button(Copy.Import.startDisc(start)) { onStartDisc?() }
            }
            if let join = actions.join {
                Button(Copy.Import.joinDisc(join)) { onJoinDisc?() }
            }
        } label: {
            HStack(spacing: 2) {
                numberText(number)
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.white.opacity(Theme.Track.numberOpacity))
                    .accessibilityHidden(true)
            }
            .padding(.leading, reach)
            .frame(width: hit, height: hit, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, -reach)
        .padding(.trailing, -reach)
        .accessibilityLabel(Copy.Import.discOptions(track: number))
        .accessibilityActions {
            if let start = actions.start {
                Button(Copy.Import.startDisc(start)) { onStartDisc?() }
            }
            if let join = actions.join {
                Button(Copy.Import.joinDisc(join)) { onJoinDisc?() }
            }
        }
        .accessibilityIdentifier("disc-menu-\(number)")
    }

    @ViewBuilder private var lengthView: some View {
        if let length {
            Text(length)
                .font(Theme.ScaledFont.subheadline)
                .monospacedDigit()
                .foregroundStyle(.white.opacity(Theme.Track.lengthOpacity))
                .lineLimit(1)
                .fixedSize()
                .accessibilityLabel(lengthSpoken ?? length)
        }
    }

    @ViewBuilder private var playsView: some View {
        if let plays {
            Text(plays)
                .font(Theme.ScaledFont.trackNumber)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
                .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: false)
        }
    }

    @ViewBuilder private var titleView: some View {
        if let titleBinding {
            // Wraps at the accessibility sizes rather than cutting the title to a few letters.
            VStack(alignment: .leading, spacing: 2) {
                InlineField(Copy.Import.track, text: titleBinding, font: Theme.ScaledFont.trackTitle, wraps: dynamicTypeSize.isAccessibilitySize)
                if !featuring.isEmpty {
                    Text(Copy.Featuring.suffix(featuring))
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            (featuring.isEmpty
                ? Text(title).foregroundStyle(Theme.primaryText)
                : Text(title).foregroundStyle(Theme.primaryText) + Text(" " + Copy.Featuring.suffix(featuring)).foregroundStyle(Theme.textDim))
                .font(Theme.ScaledFont.trackTitle)
                .lineLimit(dynamicTypeSize.isAccessibilitySize || !featuring.isEmpty ? 2 : 1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
