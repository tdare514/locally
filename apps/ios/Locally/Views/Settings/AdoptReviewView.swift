import SwiftUI
import UIKit

/// The review page for music found in the phone's own Spotify folder (#332 step 3), in the Mac's idea and the
/// iPhone's look: the studio backdrop, one glass card of found releases (cover, title, artist, song count, folder),
/// all ticked, "Already on your Mac" on any that match a release synced from the Mac, and a plain white Add
/// button. Presented from Settings and once after onboarding; closing it adds nothing.
struct AdoptReviewView: View {
    @Environment(\.appContainer) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var model: AdoptReviewModel?

    var body: some View {
        ZStack {
            StudioBackdrop()
            if let model {
                content(model)
            }
        }
        .task {
            guard model == nil, let container else { return }
            let created = AdoptReviewModel(adopter: container.adopter)
            model = created
            await created.start()
        }
    }

    // MARK: Phases

    @ViewBuilder
    private func content(_ model: AdoptReviewModel) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    switch model.phase {
                    case .idle, .scanning:
                        scanning(model.phase)
                    case .ready(let review):
                        ready(review, model)
                    case .adding:
                        status(Copy.Adopt.adding)
                    case .done(let outcome):
                        done(outcome)
                    case .failed(let message):
                        failed(message, model)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 24)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            footer(model)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Copy.Adopt.eyebrow).pageEyebrow()
            Text(Copy.Adopt.title)
                .font(Theme.ScaledFont.largeTitle)
                .foregroundStyle(Theme.primaryText)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.horizontal, 6)
    }

    private func scanning(_ phase: AdoptReviewModel.Phase) -> some View {
        var line = Copy.Adopt.scanning
        if case .scanning(let done, let total) = phase, total > 0 {
            line = Copy.Adopt.progress(done: done, total: total)
        }
        return status(line)
    }

    private func status(_ text: String) -> some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(text)
                .themeFont(.body)
                .foregroundStyle(Theme.secondaryText)
        }
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func ready(_ review: AdoptReview, _ model: AdoptReviewModel) -> some View {
        if review.items.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(Copy.Adopt.emptyTitle)
                    .themeFont(.sectionTitle)
                    .foregroundStyle(Theme.primaryText)
                Text(Copy.Adopt.emptyBody)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
            }
            .padding(.horizontal, 6)
            if review.skippedCount > 0 { note(Copy.Adopt.skipped(review.skippedCount)) }
        } else {
            Text(Copy.Adopt.summary(releases: review.items.count, songs: review.trackCount))
                .themeFont(.body)
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 6)
            GlassCard {
                ForEach(Array(review.items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { GlassDivider() }
                    AdoptReviewRow(item: item, isSelected: model.isSelected(item.id), model: model) {
                        model.toggle(item.id)
                    }
                }
            }
            note(Copy.Adopt.readOnlyNote)
            if review.skippedCount > 0 { note(Copy.Adopt.skipped(review.skippedCount)) }
        }
    }

    private func done(_ outcome: AdoptOutcome) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Copy.Adopt.doneTitle(outcome))
                .themeFont(.sectionTitle)
                .foregroundStyle(Theme.primaryText)
            let body = Copy.Adopt.doneBody(outcome)
            if !body.isEmpty {
                Text(body)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
    }

    private func failed(_ message: String, _ model: AdoptReviewModel) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Copy.Adopt.scanFailed)
                .themeFont(.body)
                .foregroundStyle(Theme.primaryText)
            Text(message)
                .themeFont(.rowSubtitle)
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
            Button(Copy.Adopt.tryAgain) { Task { await model.start() } }
                .themeFont(.body, weight: .semibold)
                .foregroundStyle(Theme.accent)
                .frame(minHeight: Theme.Spacing.minTarget, alignment: .leading)
        }
        .padding(.horizontal, 6)
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(Theme.ScaledFont.caption)
            .foregroundStyle(Theme.textHint)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 6)
    }

    // MARK: Footer

    @ViewBuilder
    private func footer(_ model: AdoptReviewModel) -> some View {
        VStack(spacing: 6) {
            switch model.phase {
            case .ready(let review) where !review.items.isEmpty:
                Button(Copy.Adopt.addCount(model.selectedCount)) { Task { await model.add() } }
                    .buttonStyle(MainButtonStyle())
                    .disabled(!model.canAdd)
                Button(Copy.Adopt.notNow) { dismiss() }
                    .themeFont(.body, weight: .semibold)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(minHeight: Theme.Spacing.minTarget)
            case .done, .ready:
                Button(Copy.Adopt.close) { dismiss() }
                    .buttonStyle(MainButtonStyle())
            default:
                Button(Copy.Adopt.notNow) { dismiss() }
                    .themeFont(.body, weight: .semibold)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(minHeight: Theme.Spacing.minTarget)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .readableColumn()
    }
}

/// One found release: a tick, its cover, title, artist, song count and folder, and the Mac badge when it matches.
private struct AdoptReviewRow: View {
    let item: AdoptReview.Item
    let isSelected: Bool
    let model: AdoptReviewModel
    let onToggle: () -> Void

    @State private var cover: UIImage?

    private var detail: String {
        let count = Copy.Adopt.songCount(item.group.tracks.count)
        return item.group.folder.isEmpty ? count : "\(count) · \(item.group.folder)"
    }

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? Theme.accent : Theme.textDim)
                    .accessibilityHidden(true)
                coverView
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.group.title)
                        .themeFont(.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(2)
                    if !item.group.artist.isEmpty {
                        Text(item.group.artist)
                            .themeFont(.rowSubtitle)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                    Text(detail)
                        .themeFont(.dropZoneHint)
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(2)
                    if item.isOnMac {
                        Text(Copy.Adopt.onMac)
                            .font(Theme.ScaledFont.pill)
                            .foregroundStyle(Theme.Tint.accentText)
                            .padding(.top, 2)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(SoftPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([item.group.title, item.group.artist, detail, item.isOnMac ? Copy.Adopt.onMac : nil]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", "))
        .accessibilityValue(isSelected ? Copy.Adopt.rowSelected : Copy.Adopt.rowNotSelected)
        .accessibilityAddTraits(.isButton)
        .task(id: item.id) {
            guard cover == nil, let data = await model.cover(for: item) else { return }
            cover = await Task.detached(priority: .utility) {
                CoverThumbnail.image(from: data, maxPixels: 160)
            }.value
        }
    }

    private var coverView: some View {
        Group {
            if let cover {
                Image(uiImage: cover)
                    .resizable()
                    .scaledToFill()
            } else {
                Theme.elevated
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.thumbnail, style: .continuous))
        .accessibilityHidden(true)
    }
}
