import SwiftUI

/// The slim Collections row at the top of the Library (#350): a way in to the Collections screen, and "New
/// collection". With no collections yet it shows the plan's line, smaller.
struct CollectionsLibraryRow: View {
    let model: CollectionsModel
    var onOpen: () -> Void
    var onNew: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
        layout {
            if let failure = model.readFailure {
                // Not "no collections": the store could not be read.
                ReadFailureView(message: failure, compact: true) { model.reload() }
            } else if model.collections.isEmpty {
                if model.isLoaded {
                    Text(Copy.Collections.emptyLine)
                        .themeFont(.meta)
                        .foregroundStyle(Theme.secondaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Button(action: onOpen) {
                    HStack(spacing: 10) {
                        CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: model.collections[0]), side: 32)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(Copy.Collections.title)
                                .themeFont(.rowTitle)
                                .foregroundStyle(Theme.primaryText)
                            Text(Copy.Collections.countLine(model.collections.count))
                                .themeFont(.meta)
                                .foregroundStyle(Theme.secondaryText)
                        }
                        Spacer(minLength: 0)
                        LocallyIcon(.chevronRight, size: 18, relativeTo: .footnote)
                            .foregroundStyle(Theme.textDim)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(Copy.Collections.title), \(Copy.Collections.countLine(model.collections.count))")
                .accessibilityHint(Copy.Collections.libraryRowHint)
            }
            Button(action: onNew) {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text(Copy.Collections.newCollection)
                }
                .themeFont(.meta, weight: .semibold)
                .foregroundStyle(Theme.accent)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Capsule().fill(Theme.Immersive.panelFill))
                .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .background(RoundedRectangle(cornerRadius: Theme.Radius.card).fill(Theme.Immersive.panelFill.opacity(0.5)))
    }
}
