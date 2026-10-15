import SwiftUI

/// The small sheet behind the record sleeve: a row of covers already in the library
/// (left out when the library has none), then Photos, Files and Remove cover. It only
/// reports the choice; `SleeveCoverPicker` acts on it once the sheet has closed.
struct CoverChoiceSheet: View {
    enum Choice {
        case recent(RecentCover)
        case photos
        case files
        case remove
    }

    let recents: [RecentCover]
    /// Remove cover is offered only when there is a cover to remove.
    let hasCover: Bool
    let onChoose: (Choice) -> Void

    /// The content's own height, so the sheet is only as tall as it needs to be. The first
    /// value is a close guess for the frame before the content has been measured.
    @State private var contentHeight: CGFloat = 340

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                Text(Copy.Import.coverDialogTitle)
                    .font(Theme.Font.sectionTitle)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)

                if !recents.isEmpty {
                    recentRow
                }

                actions
            }
            .padding(Theme.Spacing.pagePadding)
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(key: ContentHeightKey.self, value: proxy.size.height)
                }
            }
        }
        .onPreferenceChange(ContentHeightKey.self) { if $0 > 0 { contentHeight = $0 } }
        .scrollBounceBehavior(.basedOnSize)
        // The content's height plus the drag indicator's room; very large text scrolls.
        .presentationDetents([.height(contentHeight + Theme.Immersive.coverSheetGrabberRoom)])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.card)
    }

    private var recentRow: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.labelGap) {
            Text(Copy.Import.recentCovers)
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
                .accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Immersive.recentCoverGap) {
                    ForEach(recents) { recent in
                        Button { onChoose(.recent(recent)) } label: {
                            Image(uiImage: recent.thumbnail)
                                .resizable()
                                .scaledToFill()
                                .frame(width: Theme.Immersive.recentCoverSize, height: Theme.Immersive.recentCoverSize)
                                .clipShape(thumbnailShape)
                                .overlay(thumbnailShape.strokeBorder(Theme.Immersive.panelStroke, lineWidth: 1))
                        }
                        .buttonStyle(PressDimButtonStyle())
                        .accessibilityLabel(recent.accessibilityLabel)
                    }
                }
            }
            // The row scrolls edge to edge of the sheet; the margin keeps the first cover aligned with the text.
            .padding(.horizontal, -Theme.Spacing.pagePadding)
            .contentMargins(.horizontal, Theme.Spacing.pagePadding, for: .scrollContent)
        }
    }

    private var thumbnailShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Theme.Library.tileCornerRadius, style: .continuous)
    }

    /// Photos, Files and Remove cover as rows of one translucent panel (fake glass, no blur).
    private var actions: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Library.listPanelCornerRadius, style: .continuous)
        return VStack(spacing: 0) {
            actionRow(Copy.Import.coverFromPhotos, systemImage: "photo.on.rectangle", choice: .photos)
            divider
            actionRow(Copy.Import.coverFromFiles, systemImage: "folder", choice: .files)
            if hasCover {
                divider
                actionRow(Copy.Import.removeCover, systemImage: "trash", choice: .remove, color: Theme.danger)
            }
        }
        .background(shape.fill(Theme.Immersive.panelFill))
        .overlay(shape.strokeBorder(Theme.Immersive.panelStroke, lineWidth: 1))
        .clipShape(shape)
    }

    private var divider: some View {
        Rectangle().fill(Theme.Immersive.panelStroke).frame(height: 1)
    }

    private func actionRow(_ title: String, systemImage: String, choice: Choice, color: Color = Theme.primaryText) -> some View {
        Button { onChoose(choice) } label: {
            HStack(spacing: Theme.Spacing.fieldGap) {
                Image(systemName: systemImage)
                    .frame(width: Theme.Library.toggleIconSize + 6)
                    .accessibilityHidden(true)
                Text(title)
                Spacer(minLength: 0)
            }
            .font(Theme.Font.rowTitle)
            .foregroundStyle(color)
            .padding(.horizontal, Theme.Spacing.inputPaddingH)
            .padding(.vertical, Theme.Spacing.inputPaddingV)
            .frame(maxWidth: .infinity, minHeight: Theme.Immersive.panelActionMinHeight + Theme.Spacing.rowGap, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressDimButtonStyle())
    }
}

private struct ContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// Dims a button while it is pressed; no other chrome, so the panel and thumbnails stay as drawn.
private struct PressDimButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
    }
}
