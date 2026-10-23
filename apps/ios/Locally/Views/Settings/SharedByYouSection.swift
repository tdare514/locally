import SwiftUI

/// What a sent share is doing now, for its row's expiry line and whether it can be revoked.
enum SentShareStatus: Equatable {
    case live(expiresAt: Date?)
    case revoked(Date)
    case expired(Date)

    init(_ share: SentShare, now: Date) {
        if let revokedAt = share.revokedAt {
            self = .revoked(revokedAt)
        } else if let expiresAt = share.expiresAt, expiresAt <= now {
            self = .expired(expiresAt)
        } else {
            self = .live(expiresAt: share.expiresAt)
        }
    }

    var isLive: Bool { if case .live = self { true } else { false } }
}

/// Drives "Shared by you" (#183): the caller's sent shares and Revoke.
@MainActor
@Observable
final class SharedByYouModel {
    private let api: SyncApi
    private let now: () -> Date

    private(set) var shares: [SentShare] = []
    private(set) var revoking: Set<String> = []
    private(set) var errorMessage: String?

    init(api: SyncApi, shares: [SentShare] = [], now: @escaping () -> Date = { Date() }) {
        self.api = api
        self.shares = shares
        self.now = now
    }

    /// Replaces the list; a failed read keeps what was shown and says nothing (older API, offline).
    func load() async {
        guard let sent = try? await api.sentShares() else { return }
        shares = sent
    }

    func status(of share: SentShare) -> SentShareStatus { SentShareStatus(share, now: now()) }

    func revoke(_ id: String) async {
        guard !revoking.contains(id) else { return }
        revoking.insert(id)
        defer { revoking.remove(id) }
        errorMessage = nil
        do {
            try await api.revokeShare(id)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// "Shared by you" in Settings: a glass group listing what the user sent. Empty hides.
struct SharedByYouSection: View {
    @Environment(\.appContainer) private var container
    @Environment(SyncStatus.self) private var syncStatus
    @State private var model: SharedByYouModel?
    @State private var pendingRevoke: SentShare?

    var body: some View {
        Group {
            if syncStatus.signedIn, let model, !model.shares.isEmpty {
                SharedByYouList(model: model, onRevoke: { pendingRevoke = $0 }, coverFor: coverImage)
            }
        }
        .task(id: syncStatus.lastRunAt) {
            guard syncStatus.signedIn, let container else { return }
            if model == nil { model = SharedByYouModel(api: container.syncApi) }
            await model?.load()
        }
        .confirmationDialog(
            Copy.Share.revokeConfirmTitle,
            isPresented: Binding(get: { pendingRevoke != nil }, set: { if !$0 { pendingRevoke = nil } }),
            titleVisibility: .visible,
            presenting: pendingRevoke
        ) { share in
            Button(Copy.Share.revoke, role: .destructive) {
                Task { await model?.revoke(share.id) }
            }
            Button(Copy.Sync.deleteAccountCancel, role: .cancel) {}
        } message: { share in
            Text(Copy.Share.revokeConfirmMessage(people: share.recipients.count))
        }
    }

    private func coverImage(_ share: SentShare) -> UIImage? {
        UUID(uuidString: share.releaseId).flatMap { container?.coverStore.load($0) }.flatMap(UIImage.init(data:))
    }
}

/// The list itself, split out so the gallery can draw it over sample data.
struct SharedByYouList: View {
    let model: SharedByYouModel
    let onRevoke: (SentShare) -> Void
    var coverFor: (SentShare) -> UIImage? = { _ in nil }

    var body: some View {
        GlassSection(title: Copy.Share.sharedByYou) {
            GlassCard {
                ForEach(Array(model.shares.enumerated()), id: \.element.id) { index, share in
                    if index > 0 { GlassDivider() }
                    SentShareRow(
                        share: share, status: model.status(of: share), cover: coverFor(share),
                        isRevoking: model.revoking.contains(share.id), onRevoke: { onRevoke(share) }
                    )
                }
                if let error = model.errorMessage {
                    Text(error)
                        .font(Theme.ScaledFont.caption)
                        .foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                }
            }
        }
    }
}

struct SentShareRow: View {
    let share: SentShare
    let status: SentShareStatus
    let cover: UIImage?
    let isRevoking: Bool
    let onRevoke: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private static func dateText(_ date: Date) -> String { date.formatted(date: .abbreviated, time: .omitted) }

    private var summary: String {
        if share.recipients.isEmpty && share.hasLink { return Copy.Share.linkShare }
        return Copy.Share.sharedWith(share.recipients.count)
    }

    private var expiryText: String {
        switch status {
        case .live(let expiresAt): expiresAt.map { Copy.Share.expiresOn(Self.dateText($0)) } ?? Copy.Share.neverExpires
        case .revoked(let date): Copy.Share.revokedOn(Self.dateText(date))
        case .expired(let date): Copy.Share.expiredOn(Self.dateText(date))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 14) {
                Group {
                    if let cover {
                        Image(uiImage: cover).resizable().scaledToFill()
                    } else {
                        NoCoverArt()
                    }
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(share.snapshot.title)
                        .font(Theme.ScaledFont.rowTitle.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(summary)
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                    if share.hasLink && status.isLive {
                        Text(Copy.Share.linkOnBadge)
                            .font(Theme.ScaledFont.subheadline)
                            .foregroundStyle(Theme.Tint.accentText)
                    }
                    Text(expiryText)
                        .font(Theme.ScaledFont.caption)
                        .foregroundStyle(Theme.textHint)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(share.recipients, id: \.email) { recipient in
                recipientLine(recipient)
            }
            if status.isLive {
                Button(role: .destructive, action: onRevoke) {
                    Text(isRevoking ? Copy.Share.revoking : Copy.Share.revoke)
                        .font(Theme.ScaledFont.button)
                        .foregroundStyle(Theme.danger)
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isRevoking)
                .accessibilityLabel(Copy.Share.revokeTitle(share.snapshot.title))
            }
        }
        .padding(16)
        // Revoked and expired shares are greyed.
        .opacity(status.isLive ? 1 : 0.5)
    }

    private func recipientLine(_ recipient: ShareRecipient) -> some View {
        let state = recipient.claimedAt != nil ? Copy.Share.recipientAdded : Copy.Share.recipientNotYet
        return ViewThatFits(in: .horizontal) {
            HStack {
                Text(recipient.email).addressLineLimit()
                Spacer(minLength: 8)
                Text(state)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(recipient.email).addressLineLimit()
                Text(state)
            }
        }
        .font(Theme.ScaledFont.caption)
        .foregroundStyle(recipient.claimedAt != nil ? Theme.Tint.accentText : Theme.secondaryText)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(recipient.email), \(state)")
    }
}
