import SwiftUI

/// The album record (#205): the sleeve, the meta line with the Single / Album switch, the inline
/// fields, and the tracks in the faked-glass panel (reorder, swipe to delete, disc headings).
/// An album whose rows are all removed stays a record. The model, the beat and the pickers
/// belong to `ImportView`, which also shows `DoneView` and the invitation.
struct AlbumBuilderView: View {
    let model: AlbumBuilderViewModel
    let context: ImportRecordContext

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    ImportRecordSleeve(coverData: Binding(get: { model.coverData }, set: { model.coverData = $0 }), context: context)
                        .id(ImportRecordSleeve.scrollID)
                        .importClearRow()
                    ImportMetaLine(kind: context.kind, trackCount: model.rows.count, isSwitchDisabled: context.isBusy)
                        .importClearRow(top: 0, bottom: Theme.Immersive.fieldsMetaGap)
                    VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                        InlineField(Copy.Import.fieldAlbumTitle, text: Binding(get: { model.albumTitle }, set: { model.albumTitle = $0 }), font: Theme.ScaledFont.pageTitle, wraps: true)
                        InlineField(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }), font: Theme.ScaledFont.input, wraps: true)
                    }
                    .importClearRow()
                    Text(Copy.Import.albumExplainer)
                        .font(Theme.ScaledFont.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .importClearRow(top: Theme.Spacing.rowGap, bottom: Theme.Spacing.rowGap)
                    VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                        InlineField(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }), font: Theme.ScaledFont.input)
                            .keyboardType(.numberPad)
                        InlineField(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }), font: Theme.ScaledFont.input, wraps: true)
                    }
                    .importClearRow()
                }

                Section {
                    ImportTracksHeader().importPanelRow(.top)
                    if model.rows.count >= 2 {
                        Text(Copy.Import.reorderHint)
                            .font(Theme.ScaledFont.caption)
                            .foregroundStyle(Theme.textDim)
                            .importPanelRow(.middle)
                            .accessibilityIdentifier("reorder-hint")
                    }
                    if model.rows.isEmpty {
                        TrackListSilhouette(rows: 3).importPanelRow(.middle)
                    } else {
                        // Long-press drag via `.onMove` without Edit mode; disabled until there are
                        // two rows so a lone track isn't lift-able. Swipe to delete works either way.
                        let headings = model.discHeadings
                        ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, row in
                            if headings.indices.contains(index), let disc = headings[index] {
                                DiscHeading(number: disc).importPanelRow(.middle)
                            }
                            FileRow(
                                index: index + 1,
                                title: row.title,
                                isEditable: true,
                                isCompact: true,
                                onTitleChange: { newValue in setTitle(newValue, for: row) }
                            )
                            .importPanelRow(.middle)
                        }
                        .onMove(perform: model.rows.count >= 2 ? model.moveRows : nil)
                        .onDelete(perform: model.removeRows)
                    }
                    ImportAddTrackButton(action: context.onAddTrack).importPanelRow(.bottom)
                }
            }
            .importRecordList(driver: context.driver)
            // Typing mid-beat skips it too (a tag prefill from a picked file is not typing).
            .onChange(of: [model.albumTitle, model.artist, model.year, model.genre] + model.rows.map(\.title)) { _, _ in
                if !model.isLoadingTags { context.driver.skip() }
            }
            .onChange(of: context.sleeveScrollRequest) {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: Theme.Import.sendScrollDuration)) {
                    proxy.scrollTo(ImportRecordSleeve.scrollID, anchor: .top)
                }
            }
            .stickyFooter {
                // A failed send's message sits just above Send, where the tap was: Send scrolls the
                // record back to the sleeve, so a row at the end of the list would be out of view.
                if let errorMessage = model.errorMessage {
                    ImportSendError(message: errorMessage)
                }
                Button(action: context.onSend) {
                    if model.isSending {
                        VStack(spacing: 4) {
                            ProgressView().tint(.black)
                            Text(Copy.Import.taggingProgress(done: model.progressDone, total: model.progressTotal))
                                .font(Theme.Font.rowSubtitle)
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        Text(Copy.Import.send)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(PrimaryPillButtonStyle())
                .disabled(!model.canSend || context.isSendHeld)
            }
        }
    }

    /// A title binding by row id (not index), so it stays correct while
    /// `.onMove`/`.onDelete` change positions.
    private func setTitle(_ newValue: String, for row: AlbumBuilderViewModel.TrackRow) {
        if let index = model.rows.firstIndex(where: { $0.id == row.id }) {
            model.rows[index].title = newValue
        }
    }
}
