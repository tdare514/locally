import SwiftUI

// The share sheet (#183): People, Options, then Share; after it the result. Medium and large
// detents, in the app's glass groups.

private struct OpenSettingsTabKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    /// Switches to the Settings tab; set by `RootView`. `nil` where there are no tabs.
    var openSettingsTab: (() -> Void)? {
        get { self[OpenSettingsTabKey.self] }
        set { self[OpenSettingsTabKey.self] = newValue }
    }
}

/// Lays children out left to right and wraps them onto new lines.
struct WrapLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            // Proposed the line's width at most, so a long address wraps inside its pill.
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .init(width: min(result.sizes[index].width, bounds.width), height: nil))
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint], sizes: [CGSize]) {
        var origins: [CGPoint] = []
        var sizes: [CGSize] = []
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            // A child wider than the line gets the whole line.
            var size = subview.sizeThatFits(.init(width: width.isFinite ? width : nil, height: nil))
            if width.isFinite { size.width = min(size.width, width) }
            if x > 0, x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            sizes.append(size)
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return (CGSize(width: maxX, height: y + lineHeight), origins, sizes)
    }
}

struct ShareSheet: View {
    @State private var model: ShareSheetModel
    var coverImage: UIImage?
    var onClose: () -> Void

    @Environment(\.openSettingsTab) private var openSettingsTab
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var isNamingGroup = false
    @State private var groupName = ""
    @State private var linkCopied = false

    init(model: ShareSheetModel, coverImage: UIImage? = nil, onClose: @escaping () -> Void) {
        _model = State(initialValue: model)
        self.coverImage = coverImage
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            StudioBackdrop().ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    if !model.isSignedIn {
                        signedOut
                    } else if let outcome = model.outcome {
                        result(outcome)
                    } else {
                        form
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
        .task { await model.loadOptions() }
        .alert(Copy.Share.groupNameTitle, isPresented: $isNamingGroup) {
            TextField(Copy.Share.groupNamePlaceholder, text: $groupName)
            Button(Copy.Share.groupSave) { model.saveGroup(named: groupName); groupName = "" }
            Button(Copy.Share.groupCancel, role: .cancel) { groupName = "" }
        } message: {
            Text(Copy.Share.groupsStayOnDevice)
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Copy.Share.sheetTitle)
                    .font(Theme.ScaledFont.largeTitle)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text(model.subject)
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
    }

    private var signedOut: some View {
        GlassSection(title: Copy.Share.signInToShare) {
            GlassCard {
                Text(Copy.Share.signInBody)
                    .font(Theme.ScaledFont.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
                if let openSettingsTab {
                    GlassDivider()
                    Button {
                        onClose()
                        openSettingsTab()
                    } label: {
                        GlassRow(symbol: "Icon/Settings", tint: Theme.Tint.slate, title: Copy.Share.openSettings, chevron: true)
                    }
                    .buttonStyle(SoftPressStyle())
                }
            }
        }
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 22) {
            GlassSection(title: Copy.Share.peopleSection) { peopleCard }
            GlassSection(title: Copy.Share.optionsSection) { optionsCard }
            if let error = model.errorMessage {
                Text(error)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 6)
            }
            Button {
                Task { await model.send() }
            } label: {
                Text(model.isSending ? Copy.Share.sending : Copy.Share.send)
            }
            .buttonStyle(MainButtonStyle())
            .disabled(!model.canSend)
        }
    }

    private var peopleCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                if !model.emails.isEmpty {
                    WrapLayout(spacing: 8) {
                        ForEach(model.emails, id: \.self) { email in
                            EmailPill(email: email) { model.remove(email) }
                        }
                    }
                }
                GlassField(label: Copy.Share.emailLabel, placeholder: Copy.Share.emailPlaceholder, text: $model.draft, keyboardType: .emailAddress, contentType: .emailAddress)
                    .submitLabel(.done)
                    .onSubmit { model.submitDraft() }
                    .onChange(of: model.draft) { _, _ in model.draftChanged() }
                    .accessibilityHint(Copy.Share.addEmailHint)
                if let error = model.emailError {
                    Text(error)
                        .font(Theme.ScaledFont.caption)
                        .foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !model.groups.isEmpty {
                    Text(Copy.Share.groupsHeading)
                        .font(Theme.ScaledFont.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .accessibilityAddTraits(.isHeader)
                    WrapLayout(spacing: 8) {
                        ForEach(model.groups) { group in
                            GroupChip(group: group, onAdd: { model.add(group) }, onDelete: { model.delete(group) })
                        }
                    }
                }
                if model.canSaveGroup {
                    Button {
                        isNamingGroup = true
                    } label: {
                        Text(Copy.Share.saveAsGroup)
                            .font(Theme.ScaledFont.button)
                            .foregroundStyle(Theme.Tint.accentText)
                            .multilineTextAlignment(.leading)
                            .frame(minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
    }

    private var optionsCard: some View {
        GlassCard {
            if model.showsLinkOption {
                GlassToggleRow(symbol: "link", tint: Theme.Tint.teal, title: Copy.Share.link, isOn: $model.linkOn)
                if model.linkOn { note(Copy.Share.linkOn) }
                GlassDivider()
            }
            GlassToggleRow(symbol: "arrow.turn.up.right", tint: Theme.Tint.violet, title: Copy.Share.allowReshare, isOn: $model.allowReshare)
            note(model.allowReshare ? Copy.Share.reshareOn : Copy.Share.reshareOff)
            GlassDivider()
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 14) {
                    IconTile(symbol: "clock.fill", tint: Theme.Tint.slate)
                    Text(Copy.Share.expires)
                        .font(Theme.ScaledFont.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                }
                .accessibilityElement(children: .combine)
                SlimSwitch(
                    options: ShareExpiry.allCases.map { (value: $0, icon: nil, label: $0.label) },
                    selection: $model.expiry, compact: true
                )
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(Theme.ScaledFont.caption)
            .foregroundStyle(Theme.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
    }

    // MARK: Result

    private func result(_ outcome: ShareOutcome) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            GlassCard {
                if outcome.sharedCount > 0 {
                    GlassRow(symbol: "checkmark", tint: Theme.accent, title: Copy.Share.sharedWith(outcome.sharedCount))
                } else if outcome.link == nil {
                    GlassRow(symbol: "exclamationmark.triangle.fill", tint: .yellow, title: Copy.Share.nobodyReached)
                }
                ForEach(outcome.notOnLocally, id: \.self) { email in
                    if outcome.sharedCount > 0 || outcome.link != nil { GlassDivider() }
                    GlassRow(symbol: "person.crop.circle.badge.questionmark", tint: Theme.Tint.slate, title: email, value: Copy.Share.notOnLocally)
                }
                if !outcome.notOnLocally.isEmpty {
                    note(Copy.Share.notOnLocallyHint)
                }
                if let link = outcome.link {
                    if outcome.sharedCount > 0 || !outcome.notOnLocally.isEmpty { GlassDivider() }
                    linkBlock(link)
                }
            }
            Button(Copy.Share.done, action: onClose)
                .buttonStyle(MainButtonStyle())
        }
    }

    private func linkBlock(_ link: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(Copy.Share.linkReady)
                .font(Theme.ScaledFont.rowTitle)
                .foregroundStyle(Theme.primaryText)
            Text(link)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            WrapLayout(spacing: 10) {
                Button {
                    UIPasteboard.general.string = link
                    linkCopied = true
                    var message = AttributedString(Copy.Share.copied)
                    message.accessibilitySpeechAnnouncementPriority = .high
                    AccessibilityNotification.Announcement(message).post()
                } label: {
                    LinkActionLabel(title: linkCopied ? Copy.Share.copied : Copy.Share.copyLink, symbol: linkCopied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.plain)
                if let url = URL(string: link) {
                    ShareLink(item: url) {
                        LinkActionLabel(title: Copy.Share.shareLink, symbol: "square.and.arrow.up")
                    }
                    .buttonStyle(.plain)
                }
            }
            Text(Copy.Share.copyItNow)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
    }
}

/// A pill of the sheet's glass: an icon and a word, 44 pt tall.
private struct LinkActionLabel: View {
    let title: String
    let symbol: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).accessibilityHidden(true)
            Text(title).multilineTextAlignment(.leading)
        }
        .font(Theme.ScaledFont.button)
        .foregroundStyle(Theme.primaryText)
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .background(Capsule().fill(Theme.Immersive.panelFill))
        .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
        .contentShape(Capsule())
    }
}

/// A typed address as a pill with a remove button (44 pt tall).
struct EmailPill: View {
    let email: String
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(ShareEmail.breakable(email))
                .font(Theme.ScaledFont.subheadline)
                .accessibilityLabel(email)
                .foregroundStyle(Theme.primaryText)
                .multilineTextAlignment(.leading)
                .padding(.leading, 14)
                .padding(.vertical, 6)
            Button(action: onRemove) {
                LocallyIcon(.x, size: 14, relativeTo: .footnote)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Copy.Share.removePerson(email))
        }
        .frame(minHeight: 44)
        .background(Capsule().fill(Theme.accent.opacity(0.18)))
        .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

/// A saved group: tap adds its people; the context menu (or the VoiceOver action) deletes it.
struct GroupChip: View {
    let group: ShareGroup
    let onAdd: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Button(action: onAdd) {
            HStack(spacing: 6) {
                Image(systemName: "person.2.fill").accessibilityHidden(true)
                Text(group.name).multilineTextAlignment(.leading)
            }
            .font(Theme.ScaledFont.button)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Capsule().fill(Theme.Immersive.panelFill))
            .overlay(Capsule().stroke(Theme.Immersive.panelStroke, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(Copy.Share.deleteGroup(group.name), role: .destructive, action: onDelete)
        }
        .accessibilityLabel(Copy.Share.addGroup(name: group.name, count: group.emails.count))
        .accessibilityAction(named: Copy.Share.deleteGroup(group.name), onDelete)
    }
}
