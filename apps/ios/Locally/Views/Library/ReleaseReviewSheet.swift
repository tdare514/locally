import SwiftUI

/// "Check your changes": the sheet Save changes opens. One row per change, old value struck
/// through in text-dim above the new one; Save runs the save, Keep editing closes the sheet.
/// Same dark sheet as `CoverChoiceSheet`.
struct ReleaseReviewSheet: View {
    let model: ReleaseDetailViewModel
    /// The cover's glow colours for Save (`Theme.coverGlowColors`).
    let glowColors: [Color]
    let onClose: () -> Void

    @ScaledMetric(relativeTo: .body) private var thumbSize = Theme.Immersive.reviewThumbSize

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Immersive.reviewRowSpacing) {
            Text(Copy.Release.reviewTitle)
                .font(Theme.ScaledFont.fieldTitle)
                .foregroundStyle(Theme.primaryText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Immersive.reviewRowSpacing) {
                    ForEach(model.changes) { change in
                        row(change)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)

            if let error = model.errorMessage {
                Text(error)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: Theme.Immersive.reviewValueSpacing) {
                Button {
                    Task {
                        await model.save()
                        if model.errorMessage == nil { onClose() }
                    }
                } label: {
                    if model.isSaving {
                        ProgressView().tint(.white)
                    } else {
                        Text(Copy.Release.save)
                    }
                }
                .buttonStyle(CoverGlowButtonStyle(colors: glowColors))
                .disabled(model.isSaving)

                Button(Copy.Release.keepEditing, action: onClose)
                    .buttonStyle(TextButtonStyle())
                    .frame(maxWidth: .infinity, minHeight: Theme.Immersive.panelActionMinHeight)
                    .disabled(model.isSaving)
            }
        }
        .padding(Theme.Spacing.pagePadding)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.card)
        .interactiveDismissDisabled(model.isSaving)
    }

    @ViewBuilder
    private func row(_ change: ReleaseChange) -> some View {
        switch change {
        case .field(let label, let old, let new):
            labelled(label) {
                oldNew(old: old, new: new)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(label)
            .accessibilityValue(Copy.Release.changedFrom(display(old), to: display(new)))
        case .cover(let old, let new):
            labelled(Copy.Release.cover) {
                HStack(spacing: Theme.Immersive.reviewRowSpacing) {
                    thumbnail(old)
                    Image(systemName: "arrow.right")
                        .foregroundStyle(Theme.textDim)
                        .accessibilityHidden(true)
                    thumbnail(new)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Copy.Release.coverChanged)
        case .trackRenamed(_, let old, let new):
            labelled(Copy.Import.tracks) {
                oldNew(old: old, new: new)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Copy.Import.tracks)
            .accessibilityValue(Copy.Release.changedFrom(display(old), to: display(new)))
        case .trackOrder:
            Text(Copy.Release.trackOrderChanged)
                .font(Theme.ScaledFont.input)
                .foregroundStyle(Theme.primaryText)
        }
    }

    private func display(_ value: String) -> String {
        value.isEmpty ? Copy.Release.notSet : value
    }

    private func labelled<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Theme.Immersive.reviewValueSpacing) {
            Text(label)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func oldNew(old: String, new: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Immersive.reviewValueSpacing) {
            Text(display(old))
                .strikethrough()
                .foregroundStyle(Theme.textDim)
            Text(display(new))
                .foregroundStyle(Theme.primaryText)
        }
        .font(Theme.ScaledFont.input)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func thumbnail(_ data: Data?) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Immersive.reviewThumbRadius, style: .continuous)
        if let data, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: thumbSize, height: thumbSize)
                .clipShape(shape)
                .overlay(shape.strokeBorder(Theme.Immersive.panelStroke, lineWidth: 1))
                .accessibilityHidden(true)
        } else {
            shape.fill(Theme.Immersive.panelFill)
                .frame(width: thumbSize, height: thumbSize)
                .overlay(shape.strokeBorder(Theme.Immersive.panelStroke, lineWidth: 1))
                .accessibilityHidden(true)
        }
    }
}
