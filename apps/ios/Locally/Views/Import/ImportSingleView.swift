import SwiftUI
import UniformTypeIdentifiers

/// The single-track import flow: pick one audio file, edit its tags, pick a
/// cover, and send it to Spotify's folder. Shows `DoneView` on success.
/// Embedded as one segment of `ImportView`, which owns the surrounding
/// `NavigationStack` and title.
struct ImportSingleView: View {
    @Environment(\.appContainer) private var container

    /// Files shared in from other apps to work through, one at a time, as
    /// soon as the model exists. Passed down from `ImportView`'s "Add as
    /// singles" action; empty for a normal visit to this tab.
    var inboxQueue: [InboxFile] = []
    /// Called once `inboxQueue` has been handed to the model, so the parent
    /// can clear its copy and not re-offer the same files if this view is
    /// recreated (e.g. after switching to Album and back).
    var onInboxQueueConsumed: () -> Void = {}

    /// Which of the two document pickers is showing. One `.fileImporter`
    /// serves both because SwiftUI presents only one per view.
    private enum Picker { case audio, cover }

    @State private var model: ImportSingleViewModel?
    @State private var activePicker: Picker?
    /// Separate from `activePicker`: SwiftUI flips this false before the
    /// completion handler runs, so the kind must survive the dismissal.
    @State private var isPickerPresented = false
    /// Raw bytes from the Files cover pick, handed to `CoverPicker` to
    /// crop; see `CoverPicker.rawPick`.
    @State private var rawCoverPick: Data?
    /// Backdrop colours taken from the cover; neutral until one is picked.
    @State private var palette = AmbientPalette.neutral
    /// Bumped on a successful send to play the sleeve ceremony.
    @State private var ceremony = 0
    /// True from the Send tap until the ceremony has played, so `DoneView` waits for it.
    @State private var holdingForCeremony = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            ArtworkBackdrop(palette: palette).ignoresSafeArea()

            if let model, model.completedRelease != nil, !holdingForCeremony {
                DoneView(kind: .single) {
                    model.reset()
                }
            } else if let model {
                form(model)
            }
        }
        .task {
            if model == nil, let container {
                model = ImportSingleViewModel(importer: container.importer, coordinator: container.coordinator, inbox: container.inbox)
            }
        }
        .task(id: model?.coverData) {
            let data = model?.coverData
            palette = await Task.detached { ArtworkPalette.palette(forCover: data) }.value
        }
        .task(id: inboxQueue) {
            guard !inboxQueue.isEmpty, let model else { return }
            await model.startInboxQueue(inboxQueue)
            onInboxQueueConsumed()
        }
    }

    @ViewBuilder
    private func form(_ model: ImportSingleViewModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.sectionGap) {
                fileChooser(model)

                if model.pickedURL != nil {
                    VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                        SleeveCoverPicker(
                            imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 }),
                            rawPick: $rawCoverPick,
                            ceremony: ceremony
                        ) {
                            activePicker = .cover
                            isPickerPresented = true
                        }
                        InlineField(Copy.Import.fieldTitle, text: Binding(get: { model.title }, set: { model.title = $0 }), font: Theme.Font.pageTitle)
                        InlineField(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }))
                        InlineField(Copy.Import.fieldAlbum, text: Binding(get: { model.album }, set: { model.album = $0 }))
                        InlineField(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }))
                            .keyboardType(.numberPad)
                        InlineField(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }))
                    }

                    if let errorMessage = model.errorMessage {
                        Text(errorMessage)
                            .font(Theme.Font.rowSubtitle)
                            .foregroundStyle(Theme.danger)
                    }
                } else {
                    TrackListSilhouette(rows: 1)
                }
            }
            .padding(Theme.Spacing.pagePadding)
        }
        .stickyFooter {
            Button {
                Task {
                    holdingForCeremony = true
                    await model.send()
                    if model.completedRelease != nil, !reduceMotion {
                        ceremony += 1
                        try? await Task.sleep(for: .seconds(Theme.Immersive.ceremonyDuration))
                    }
                    holdingForCeremony = false
                }
            } label: {
                if model.isSending {
                    ProgressView().tint(.black)
                } else {
                    Text(Copy.Import.send)
                }
            }
            .buttonStyle(PrimaryPillButtonStyle())
            .disabled(!model.canSend || holdingForCeremony)
        }
        .fileImporter(
            isPresented: $isPickerPresented,
            allowedContentTypes: activePicker == .cover ? [.image] : [.audio]
        ) { result in
            let picker = activePicker
            activePicker = nil
            guard case .success(let url) = result else { return }
            switch picker {
            case .audio:
                Task { await model.pick(url: url) }
            case .cover:
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                rawCoverPick = try? Data(contentsOf: url)
            case nil:
                break
            }
        }
    }

    /// A `card` drop-zone block with a dashed border: once a file is picked,
    /// shows its name; otherwise an upload icon, the caption and hint.
    /// Matches `docs/design.md`'s "Audio drop zone" component (iOS has no
    /// drag-and-drop, so tapping is the only way in).
    private func fileChooser(_ model: ImportSingleViewModel) -> some View {
        Button {
            activePicker = .audio
            isPickerPresented = true
        } label: {
            VStack(spacing: 8) {
                if model.pickedName == nil {
                    Image(systemName: "icloud.and.arrow.up")
                        .font(.system(size: 26))
                        .foregroundStyle(Theme.secondaryText)
                }
                Text(model.pickedName ?? Copy.Import.fileCaption)
                    .font(Theme.Font.dropZoneLine)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if model.pickedName == nil {
                    Text(Copy.Import.singleFileHint)
                        .font(Theme.Font.dropZoneHint)
                        .foregroundStyle(Theme.textHint)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 80)
            .padding(.horizontal, 12)
            .padding(.vertical, 24)
        }
        .buttonStyle(.plain)
        .dropZone()
    }
}
