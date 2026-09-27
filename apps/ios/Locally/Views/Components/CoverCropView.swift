import SwiftUI

/// Presented as a sheet right after a cover image is picked (Photos or
/// Files). Shows the image under a fixed selection frame — pinch to zoom,
/// drag to pan, with a ratio control (Square, the default, or Original) —
/// and hands back the cropped/rescaled image data on Done. Cancel leaves
/// whatever cover was there before untouched.
///
/// The selection frame never moves: gestures update `cropRect` (in image
/// space) via `CropGeometry`, and the image is drawn scaled/offset so that
/// `cropRect` always exactly fills the frame — the usual iOS crop UX. The
/// whole sheet is styled as `docs/design.md`'s "Crop dialog" component: a
/// `card` surface with a `dialog-border`, floating on the black background.
struct CoverCropView: View {
    let imageData: Data
    let onDone: (Data) -> Void
    let onCancel: () -> Void

    @State private var ratio: CoverRatio = .square
    @State private var uiImage: UIImage?
    @State private var imageSize: CGSize = .zero
    @State private var cropRect: CGRect = .zero
    @State private var gestureStartRect: CGRect = .zero

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            dialog
                .padding(20)
        }
        .task { loadImage() }
    }

    private var dialog: some View {
        VStack(spacing: 16) {
            Text(Copy.Cover.cropTitle)
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Theme.primaryText)

            cropCanvas

            SegmentedPill(
                options: [(CoverRatio.square, Copy.Cover.square), (CoverRatio.original, Copy.Cover.original)],
                selection: $ratio,
                isCompact: true
            )
            .onChange(of: ratio) { _, newValue in
                resetCropRect(CropGeometry.initialRect(imageSize: imageSize, ratio: newValue))
            }

            Text(Copy.Cover.squareHint)
                .font(.footnote)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .opacity(ratio == .square ? 1 : 0)

            HStack(spacing: 20) {
                Spacer()
                Button(Copy.Cover.cancel, action: onCancel)
                    .buttonStyle(TextButtonStyle())
                Button(Copy.Cover.done, action: process)
                    .buttonStyle(PrimaryPillButtonStyle(isFullWidth: false))
                    .disabled(uiImage == nil)
            }
        }
        .padding(20)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.dialog))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.dialog)
                .stroke(Theme.dialogBorder, lineWidth: 1)
        )
    }

    private var cropCanvas: some View {
        GeometryReader { proxy in
            ZStack {
                if let uiImage {
                    let frame = imageFrame(containerSize: proxy.size)
                    Image(uiImage: uiImage)
                        .resizable()
                        .frame(width: frame.width, height: frame.height)
                        .position(x: frame.midX, y: frame.midY)
                }
                selectionOverlay(containerSize: proxy.size)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
            .contentShape(Rectangle())
            .gesture(panGesture(containerSize: proxy.size))
            .simultaneousGesture(zoomGesture())
        }
        .frame(height: 280)
        .background(Color(red: 0x05 / 255, green: 0x05 / 255, blue: 0x05 / 255))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Loading

    private func loadImage() {
        guard uiImage == nil, let image = UIImage(data: imageData) else { return }
        uiImage = image
        imageSize = image.size
        resetCropRect(CropGeometry.initialRect(imageSize: image.size, ratio: ratio))
    }

    private func resetCropRect(_ rect: CGRect) {
        cropRect = rect
        gestureStartRect = rect
    }

    // MARK: - Layout

    /// The fixed on-screen selection frame: a centred square for `.square`,
    /// or the image's own aspect (fit to the canvas) for `.original`.
    private func viewfinderRect(containerSize: CGSize) -> CGRect {
        let maxSide = min(containerSize.width, containerSize.height) - 20
        let size: CGSize
        switch ratio {
        case .square:
            size = CGSize(width: maxSide, height: maxSide)
        case .original:
            if imageSize.width > 0, imageSize.height > 0 {
                let aspect = imageSize.width / imageSize.height
                size = aspect >= 1
                    ? CGSize(width: maxSide, height: maxSide / aspect)
                    : CGSize(width: maxSide * aspect, height: maxSide)
            } else {
                size = CGSize(width: maxSide, height: maxSide)
            }
        }
        let origin = CGPoint(x: (containerSize.width - size.width) / 2, y: (containerSize.height - size.height) / 2)
        return CGRect(origin: origin, size: size)
    }

    /// Where the (unscaled-by-SwiftUI) image should be drawn so that
    /// `cropRect` lines up exactly with the viewfinder.
    private func imageFrame(containerSize: CGSize) -> CGRect {
        guard cropRect.width > 0, cropRect.height > 0 else { return .zero }
        let viewfinder = viewfinderRect(containerSize: containerSize)
        let scale = viewfinder.width / cropRect.width
        let displayedSize = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        let origin = CGPoint(
            x: viewfinder.minX - cropRect.minX * scale,
            y: viewfinder.minY - cropRect.minY * scale
        )
        return CGRect(origin: origin, size: displayedSize)
    }

    /// Matches `docs/design.md`'s "Crop dialog" preview: an outer white 25%
    /// border around the viewfinder, centre guide lines at white 10%, and an
    /// inner frame inset 12 pt at white 60%, over a dimmed surround so the
    /// selection reads clearly against the rest of the image.
    private func selectionOverlay(containerSize: CGSize) -> some View {
        let viewfinder = viewfinderRect(containerSize: containerSize)
        return ZStack {
            Path { path in
                path.addRect(CGRect(origin: .zero, size: containerSize))
                path.addRect(viewfinder)
            }
            .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))

            Rectangle()
                .stroke(Color.white.opacity(0.25), lineWidth: 1)
                .frame(width: viewfinder.width, height: viewfinder.height)
                .position(x: viewfinder.midX, y: viewfinder.midY)

            Path { path in
                path.move(to: CGPoint(x: viewfinder.midX, y: viewfinder.minY))
                path.addLine(to: CGPoint(x: viewfinder.midX, y: viewfinder.maxY))
                path.move(to: CGPoint(x: viewfinder.minX, y: viewfinder.midY))
                path.addLine(to: CGPoint(x: viewfinder.maxX, y: viewfinder.midY))
            }
            .stroke(Color.white.opacity(0.10), lineWidth: 1)

            Rectangle()
                .stroke(Color.white.opacity(0.60), lineWidth: 1)
                .frame(width: max(viewfinder.width - 24, 0), height: max(viewfinder.height - 24, 0))
                .position(x: viewfinder.midX, y: viewfinder.midY)
        }
        .allowsHitTesting(false)
    }

    // MARK: - Gestures

    private func panGesture(containerSize: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                guard gestureStartRect.width > 0 else { return }
                let viewfinder = viewfinderRect(containerSize: containerSize)
                let scale = viewfinder.width / gestureStartRect.width
                guard scale > 0 else { return }
                let delta = CGSize(width: -value.translation.width / scale, height: -value.translation.height / scale)
                cropRect = CropGeometry.panned(rect: gestureStartRect, by: delta, imageSize: imageSize)
            }
            .onEnded { _ in
                gestureStartRect = cropRect
            }
    }

    private func zoomGesture() -> some Gesture {
        MagnificationGesture()
            .onChanged { value in
                guard gestureStartRect.width > 0 else { return }
                let center = CGPoint(x: gestureStartRect.midX, y: gestureStartRect.midY)
                cropRect = CropGeometry.zoomed(
                    rect: gestureStartRect,
                    scale: value,
                    about: center,
                    ratio: ratio,
                    imageSize: imageSize
                )
            }
            .onEnded { _ in
                gestureStartRect = cropRect
            }
    }

    // MARK: - Done

    private func process() {
        let cropped = CoverImageProcessor.crop(imageData, to: cropRect) ?? imageData
        onDone(cropped)
    }
}
