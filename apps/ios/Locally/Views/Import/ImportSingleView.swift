import SwiftUI

/// The single-track record (#205): the sleeve, the meta line with the Single / Album switch,
/// the inline fields, and the one track in the faked-glass panel. The model, the beat and the
/// pickers belong to `ImportView`, which also shows `DoneView` and the invitation.
struct ImportSingleView: View {
    let model: ImportSingleViewModel
    let context: ImportRecordContext

    var body: some View {
        List {
            Section {
                ImportRecordSleeve(coverData: Binding(get: { model.coverData }, set: { model.coverData = $0 }), context: context)
                    .importClearRow()
                ImportMetaLine(kind: context.kind, trackCount: model.pickedURL == nil ? 0 : 1, isSwitchDisabled: context.isBusy)
                    .importClearRow(top: 0, bottom: Theme.Immersive.fieldsMetaGap)
                VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                    InlineField(Copy.Import.fieldTitle, text: Binding(get: { model.title }, set: { model.title = $0 }), font: Theme.ScaledFont.pageTitle, wraps: true)
                    InlineField(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }), font: Theme.ScaledFont.input, wraps: true)
                    InlineField(Copy.Import.albumPlaceholder, text: Binding(get: { model.album }, set: { model.album = $0 }), font: Theme.ScaledFont.input, wraps: true)
                    InlineField(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }), font: Theme.ScaledFont.input)
                        .keyboardType(.numberPad)
                    InlineField(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }), font: Theme.ScaledFont.input, wraps: true)
                }
                .importClearRow()
            }

            Section {
                ImportTracksHeader().importPanelRow(.top)
                if model.pickedURL != nil, let name = model.pickedName {
                    FileRow(index: 1, title: name, isCompact: true, showsChevron: false)
                        .importPanelRow(.middle)
                } else {
                    TrackListSilhouette(rows: 1).importPanelRow(.middle)
                }
                if let errorMessage = model.errorMessage {
                    Text(errorMessage)
                        .font(Theme.ScaledFont.caption)
                        .foregroundStyle(Theme.danger)
                        .importPanelRow(.middle)
                }
                ImportAddTrackButton(action: context.onAddTrack).importPanelRow(.bottom)
            }
        }
        .importRecordList(driver: context.driver)
        // Typing mid-beat skips it too (a tag prefill from a picked file is not typing).
        .onChange(of: [model.title, model.artist, model.album, model.year, model.genre]) { _, _ in
            if !model.isLoadingTags { context.driver.skip() }
        }
        .stickyFooter {
            Button(action: context.onSend) {
                if model.isSending {
                    ProgressView().tint(.black)
                } else {
                    Text(Copy.Import.send)
                }
            }
            .buttonStyle(PrimaryPillButtonStyle())
            .disabled(!model.canSend || context.isSendHeld)
        }
    }
}
