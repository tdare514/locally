import SwiftUI
import UniformTypeIdentifiers

/// The single-track import flow: pick one audio file, edit its tags, pick a
/// cover, and send it to Spotify's folder. Shows `DoneView` on success.
/// Embedded as one segment of `ImportView`, which owns the surrounding
/// `NavigationStack` and title.
struct ImportSingleView: View {
    @Environment(\.appContainer) private var container

    /// Which of the two document pickers is showing. One `.fileImporter`
    /// serves both because SwiftUI presents only one per view.
    private enum Picker { case audio, cover }

    @State private var model: ImportSingleViewModel?
    @State private var activePicker: Picker?
    /// Separate from `activePicker`: SwiftUI flips this false before the
    /// completion handler runs, so the kind must survive the dismissal.
    @State private var isPickerPresented = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            if let model, model.completedRelease != nil {
                DoneView(kind: .single) {
                    model.reset()
                }
            } else if let model {
                form(model)
            }
        }
        .task {
            if model == nil, let container {
                model = ImportSingleViewModel(importer: container.importer, coordinator: container.coordinator)
            }
        }
    }

    @ViewBuilder
    private func form(_ model: ImportSingleViewModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Button {
                    activePicker = .audio
                    isPickerPresented = true
                } label: {
                    Label(
                        model.pickedURL?.lastPathComponent ?? Copy.Import.pickFile,
                        systemImage: "waveform"
                    )
                }
                .buttonStyle(.bordered)
                .tint(Theme.accent)

                if model.pickedURL != nil {
                    Field(Copy.Import.fieldTitle, text: Binding(get: { model.title }, set: { model.title = $0 }))
                    Field(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }))
                    Field(Copy.Import.fieldAlbum, placeholder: Copy.Import.albumPlaceholder, text: Binding(get: { model.album }, set: { model.album = $0 }))
                    Field(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }), keyboardType: .numberPad)
                    Field(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }))

                    CoverPicker(imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 })) {
                        activePicker = .cover
                        isPickerPresented = true
                    }

                    if let errorMessage = model.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button {
                        Task { await model.send() }
                    } label: {
                        if model.isSending {
                            ProgressView().tint(.white)
                        } else {
                            Text(Copy.Import.send)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(!model.canSend)
                }
            }
            .padding(20)
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
                model.coverData = try? Data(contentsOf: url)
            case nil:
                break
            }
        }
    }
}
