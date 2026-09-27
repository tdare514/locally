import SwiftUI
import UniformTypeIdentifiers

/// Phase 1's only import flow: pick one audio file, edit its tags, pick a
/// cover, and send it to Spotify's folder. Shows `DoneView` on success.
struct ImportSingleView: View {
    @Environment(\.appContainer) private var container

    @State private var model: ImportSingleViewModel?
    @State private var isPresentingFilePicker = false

    var body: some View {
        NavigationStack {
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
            .navigationTitle(Copy.Import.title)
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
                    isPresentingFilePicker = true
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

                    CoverPicker(imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 }))

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
        .fileImporter(isPresented: $isPresentingFilePicker, allowedContentTypes: [.audio]) { result in
            guard case .success(let url) = result else { return }
            Task { await model.pick(url: url) }
        }
    }
}

/// The confirmation screen shown after a successful send, with the exact
/// copy for a single or an album (phase 2) release.
struct DoneView: View {
    enum Kind { case single, album }

    let kind: Kind
    let onAddAnother: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(Theme.accent)

            Text(kind == .single ? Copy.Import.doneSingle : Copy.Import.doneAlbum)
                .foregroundStyle(Theme.primaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Button(Copy.Import.addAnother, action: onAddAnother)
                .buttonStyle(.bordered)
                .tint(Theme.accent)
        }
    }
}
