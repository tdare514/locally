import SwiftUI

extension View {
    /// Fake glass: a faint white fill and a hairline stroke, no blur over the backdrop.
    func fakeGlass<S: InsettableShape>(_ shape: S) -> some View {
        background(Theme.Immersive.panelFill, in: shape)
            .overlay(shape.strokeBorder(Theme.Immersive.panelStroke, lineWidth: 1))
    }
}

/// Where a `List` row sits in its panel card, so its background can draw the card's edges.
enum PanelEdge { case top, middle, bottom }

/// A row background for the record's panels. A `List` section can only be styled row by
/// row, so each row paints the fill, with no outline. `edge` is kept so callers still say where
/// the row sits.
struct PanelRowBackground: View {
    let edge: PanelEdge

    var body: some View {
        Theme.Immersive.panelFill
    }
}

/// The floating save control under the record: a compact centred capsule holding an
/// "Unsaved changes" / "Saved to your library" status and Save.
struct ReleaseDock: View {
    let model: ReleaseDetailViewModel
    /// The cover's glow colours for Save (`Theme.coverGlowColors`).
    let glowColors: [Color]

    @State private var showSaved = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var status: String? {
        if model.hasChanges { return Copy.Immersive.unsavedChanges }
        return showSaved ? Copy.Immersive.savedToLibrary : nil
    }

    var body: some View {
        pill
        .padding(.bottom, Theme.Immersive.dockBottomPadding)
        .animation(reduceMotion ? nil : .easeInOut(duration: Theme.Immersive.dockStatusFade), value: status)
        .task(id: model.saveCount) {
            guard model.saveCount > 0 else { return }
            showSaved = true
            try? await Task.sleep(for: .seconds(Theme.Immersive.savedToastSeconds))
            if !Task.isCancelled { showSaved = false }
        }
    }

    private var pill: some View {
        HStack(spacing: Theme.Immersive.dockGap) {
            if let status {
                statusText(status).padding(.leading, Theme.Immersive.dockGap)
            }
            saveButton
        }
        .padding(6)
        .background(Theme.Immersive.dockUnderlay, in: Capsule())
        .fakeGlass(Capsule())
        .frame(maxWidth: .infinity)
    }

    private func statusText(_ text: String) -> some View {
        Text(text)
            .font(Theme.Font.meta)
            .foregroundStyle(model.hasChanges ? Theme.secondaryText : Theme.primaryText)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .transition(.opacity)
    }

    private var saveButton: some View {
        Button {
            Task { await model.save() }
        } label: {
            HStack(spacing: 6) {
                if !model.isSaving {
                    Image(systemName: "checkmark").accessibilityHidden(true)
                }
                Text(model.isSaving ? Copy.Detail.saving : Copy.Detail.saveChanges)
                    .lineLimit(1)
            }
            .fixedSize()
        }
        .buttonStyle(CoverGlowButtonStyle(colors: glowColors, isFullWidth: false))
        .disabled(!model.canSave)
    }
}
