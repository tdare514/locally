import Foundation

/// Switching Single / Album on the record keeps the draft (#205). Functions over the two models:
/// the source is cleared afterwards, its share queue untouched, and no file is deleted or staged
/// again. The cover is copied without touching the beat (`ImportBeatDriver` is not involved).
enum ImportKindSwitch {
    /// The picked file becomes the album's one row, titled with the single's title. The album
    /// title is the single's album, or its title when the album is empty.
    static func singleToAlbum(_ single: ImportSingleViewModel, into album: AlbumBuilderViewModel) {
        album.rows = single.pickedURL.map { [AlbumBuilderViewModel.TrackRow(url: $0, title: single.title)] } ?? []
        album.albumTitle = single.album.isEmpty ? single.title : single.album
        album.artist = single.artist
        album.year = single.year
        album.genre = single.genre
        album.coverData = single.coverData
        single.clearDraft()
    }

    /// The first row becomes the picked file (url, name, title) and the album title goes to the
    /// single's album field. The other rows are dropped.
    static func albumToSingle(_ album: AlbumBuilderViewModel, into single: ImportSingleViewModel) {
        let first = album.rows.first
        single.pickedURL = first?.url
        single.pickedName = first?.url.lastPathComponent
        single.title = first?.title ?? ""
        single.album = album.albumTitle
        single.artist = album.artist
        single.year = album.year
        single.genre = album.genre
        single.coverData = album.coverData
        single.errorMessage = nil
        album.reset()
    }
}
