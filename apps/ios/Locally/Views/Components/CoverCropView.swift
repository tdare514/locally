import SwiftUI

/// Presented as a sheet right after a cover image is picked (Photos or
/// Files). Shows the image under a fixed selection frame — pinch to zoom,
/// drag to pan, with a ratio control (Square, the default, or Original) —
/// and hands back the cropped/rescaled image data on Done. Cancel leaves
/// whatever cover was there before untouched.
///
/// The selection frame never moves: gestures update `cropRect` (in image
/// space) via `CropGeometry`, and the image is drawn scaled/offset so that
/// `cropRect` always exactly fills the frame — the usual iOS crop UX.
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
        NavigationStack {
            VStack(spacing: 16) {
                Picker("", selection: $ratio) {
                    ForEach(CoverRatio.allCases, id: \.self) { ratio in
                        Text(ratio.displayName).tag(ratio)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .onChange(of: ratio) { _, newValue in
                    resetCropRect(CropGeometry.initialRect(imageSize: imageSize, ratio: newValue))
                }

                Text(Copy.Cover.squareHint)
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                    .opacity(ratio == .square ? 1 : 0)
                    .padding(.horizontal, 20)

                cropCanvas
                    .padding(.horizontal, 20)

                Spacer()
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Copy.Cover.cropTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Copy.Cover.cancel, action: onCancel)
                        .foregroundStyle(Theme.primaryText)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Copy.Cover.done, action: process)
                        .disabled(uiImage == nil)
                        .tint(Theme.accent)
                }
            }
        }
        .task { loadImage() }
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
        .frame(height: 320)
        .background(Theme.panel)
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

    private func selectionOverlay(containerSize: CGSize) -> some View {
        let viewfinder = viewfinderRect(containerSize: containerSize)
        return ZStack {
            Path { path in
                path.addRect(CGRect(origin: .zero, size: containerSize))
                path.addRect(viewfinder)
            }
            .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))

            Rectangle()
                .stroke(Theme.accent, lineWidth: 2)
                .frame(width: viewfinder.width, height: viewfinder.height)
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
