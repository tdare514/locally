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

    @State private var isNaming = false
    @State private var newName = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                List {
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
                            let added = model.add(items, to: collection.id)
                            announce(Copy.Collections.added(added, to: collection.name))
                            onDone()
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
                if model.create(name: name, items: items) != nil {
                    announce(Copy.Collections.added(items.count, to: name))
                    onDone()
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
    }

    private func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}
