# Third-party components bundled in Locally

Locally ships an unmodified build of the components below, as a separate executable
(`Contents/Resources/ffmpeg`) that the app runs as its own process. The LGPL texts are in this
directory. The source archives are available at the URLs listed here.

| Component | Version | Licence | Source | SHA-256 |
|-----------|---------|---------|--------|---------|
| FFmpeg | 9.0.2 | LGPL 2.1 or later (built with --disable-gpl --disable-nonfree --disable-version3) | https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz | 8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e |
| LAME (libmp3lame) | 3.100 | LGPL 2 or later | https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz | ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e |

LAME is built as a static library and linked into the ffmpeg executable. The only change to its
sources is deleting the `lame_init_old` line from `include/libmp3lame.sym` so it links on macOS.

FFmpeg configure line (<prefix> is the local LAME install directory):

```
./configure --prefix=<prefix> --disable-gpl --disable-nonfree --disable-version3 --disable-shared --enable-static --pkg-config-flags=--static --disable-programs --enable-ffmpeg --disable-doc --disable-network --disable-autodetect --disable-debug --disable-everything --enable-libmp3lame --enable-protocol=file --enable-demuxer=mp3,wav,flac,mov,aiff --enable-decoder=mp3float,mp3,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_s16be,pcm_s24be,pcm_s32be,pcm_u8,pcm_alaw,pcm_mulaw,flac,aac,alac --enable-parser=mpegaudio,flac,aac --enable-encoder=libmp3lame --enable-muxer=mp3 --enable-filter=abuffer,abuffersink,aformat,aresample,anull,atrim --enable-swresample --extra-cflags=-I<prefix>/include --extra-ldflags=-L<prefix>/lib
```

Rebuild with `npm run desktop:ffmpeg` in `apps/web` (`scripts/build-ffmpeg.sh`).
