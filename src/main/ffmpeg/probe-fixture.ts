/** Saídas reais (resumidas) de `ffmpeg -version` e `-encoders`, para testes. */
export const VERSION_OUTPUT = `ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers
built with gcc 16.2.0 (Rev3, Built by MSYS2 project)
configuration: --enable-gpl --enable-version3 --enable-libsvtav1
`

export const ENCODERS_OUTPUT = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)
 A....D libopus              libopus Opus (codec opus)
 S..... srt                  SubRip subtitle (codec subrip)
`
