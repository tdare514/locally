import SwiftUI

/// What a row or the release page adds: a whole release, or one of its tracks.
struct AddToCollectionTarget: Identifiable {
    let id = UUID()
    let items: [CollectionItem]
}

/// The sheet behind "Add to collection" (#350): the collections to pick from, and "New collection" to make one
/// that starts with these items.
struct AddToCollectionSheet: View {
    let model: CollectionsModel
    let items: [CollectionItem]
    var onDone: () -> Void
    @State private var failure: Failure?

    /// `initialFailure` opens the sheet already showing a failed save (the debug gallery's screenshot).
    init(model: CollectionsModel, items: [CollectionItem], initialFailure: String? = nil, onDone: @escaping () -> Void) {
        self.model = model
        self.items = items
        self.onDone = onDone
        _failure = State(initialValue: initialFailure.map { Failure(message: $0, retry: {}) })
    }

    @State private var isNaming = false
    @State private var newName = ""
    /// A save that failed: what to say, and what Try again repeats.
    private struct Failure {
        let message: String
        let retry: () -> Void
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                List {
                    if let failure {
                        failureRow(failure)
                    }
                    Button {
                        newName = ""
                        isNaming = true
                    } label: {
                        Label(Copy.Collections.newCollection, systemImage: "plus")
                            .themeFont(.rowTitle)
                            .foregroundStyle(Theme.accent)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .listRowBackground(Theme.Immersive.panelFill)
                    ForEach(model.collections) { collection in
                        Button {
                            add(to: collection)
                        } label: {
                            HStack(spacing: 12) {
                                CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection), side: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(collection.name)
                                        .themeFont(.rowTitle)
                                        .foregroundStyle(Theme.primaryText)
                                    Text(Copy.Collections.trackCount(model.trackCount(of: collection)))
                                        .themeFont(.rowSubtitle)
                                        .foregroundStyle(Theme.secondaryText)
                                }
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 44)
                        }
                        .listRowBackground(Theme.Immersive.panelFill)
                        .accessibilityLabel(Copy.Collections.rowLabel(name: collection.name, tracks: model.trackCount(of: collection)))
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(Copy.Collections.addSheetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Copy.Collections.cancel, action: onDone)
                }
            }
            .task { model.reload() }
            .nameAlert(Copy.Collections.nameTitle, action: Copy.Collections.create, isPresented: $isNaming, text: $newName) { name in
                create(named: name)
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
    }

    private func add(to collection: MusicCollection) {
        do {
            let added = try model.add(items, to: collection.id)
            failure = nil
            announce(Copy.Collections.added(added, to: collection.name))
            onDone()
        } catch {
            fail(Copy.Collections.addFailed(to: collection.name)) { add(to: collection) }
        }
    }

    private func create(named name: String) {
        do {
            guard try model.create(name: name, items: items) != nil else { return }
            failure = nil
            announce(Copy.Collections.added(items.count, to: name))
            onDone()
        } catch {
            fail(Copy.Collections.createFailed) { create(named: name) }
        }
    }

    /// The sheet stays open: the error shows inline and VoiceOver hears it.
    private func fail(_ message: String, retry: @escaping () -> Void) {
        failure = Failure(message: message, retry: retry)
        announce("\(message) \(Copy.Collections.tryAgain)")
    }

    private func failureRow(_ failure: Failure) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(failure.message)
                .themeFont(.body)
                .foregroundStyle(Theme.danger)
            Button(Copy.Collections.tryAgain, action: failure.retry)
                .buttonStyle(CollectionPillButtonStyle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .listRowBackground(Theme.Immersive.panelFill)
        .accessibilityElement(children: .combine)
    }

    private func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}
