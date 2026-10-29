# ffmpeg 9.0.2 and gifski 1.34.0 as WebAssembly, for the browser engine
# (client/src/engine). Library commits are BtbN's for the native 9.0.2 build
# (scripts/binaries.mjs), so both engines encode with the same code.
#
#   docker build -f wasm/Dockerfile --output client/public/engine wasm
FROM emscripten/emsdk:6.0.13 AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config autoconf automake libtool cmake meson ninja-build
ENV PREFIX=/opt
ENV CFLAGS="-O3 -msimd128 -pthread -I$PREFIX/include"
ENV CXXFLAGS="$CFLAGS" LDFLAGS="-pthread -L$PREFIX/lib"
ENV EM_PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig
# Shallow fetch of one commit: fetch <repo> <commit> <dir>
RUN printf '#!/bin/sh\nset -e\ngit init -q "$3"\ngit -C "$3" fetch -q --depth 1 "$1" "$2"\ngit -C "$3" checkout -q FETCH_HEAD\n' \
      > /usr/local/bin/fetch && chmod +x /usr/local/bin/fetch
WORKDIR /src

FROM base AS zlib
RUN fetch https://github.com/madler/zlib.git e3dc0a85b7032e98380dec011bc8f2c2ee0d8fca zlib
RUN cd zlib && emconfigure ./configure --static --prefix=$PREFIX && emmake make -j"$(nproc)" install

FROM base AS x264
RUN fetch https://code.videolan.org/videolan/x264.git 0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee x264
# Lookahead threads (12+ threads) call this through a void *(*)(void *):
# harmless natively, a signature-mismatch trap in WebAssembly.
COPY x264-slice-cost.patch .
RUN git -C x264 apply ../x264-slice-cost.patch
RUN cd x264 && emconfigure ./configure --prefix=$PREFIX --host=i686-gnu --enable-static \
      --disable-cli --disable-asm --disable-lavf --disable-swscale --extra-cflags="$CFLAGS" \
    && emmake make -j"$(nproc)" install-lib-static

FROM base AS libvpx
RUN fetch https://chromium.googlesource.com/webm/libvpx 9cc8e1c18024d6b64422ecb7fdd7a43c8e873908 libvpx
RUN cd libvpx && emconfigure ./configure --prefix=$PREFIX --target=generic-gnu \
      --disable-shared --enable-static --disable-examples --disable-tools --disable-docs \
      --disable-unit-tests --disable-install-bins --enable-vp9-highbitdepth \
      --extra-cflags="$CFLAGS" --extra-cxxflags="$CXXFLAGS" \
    && emmake make -j"$(nproc)" install && emranlib $PREFIX/lib/libvpx.a

FROM base AS aom
RUN fetch https://aomedia.googlesource.com/aom 95f420511f698ea201e8928464704dc30da4b568 aom
RUN mkdir aom/out && cd aom/out && emcmake cmake .. -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=$PREFIX -DBUILD_SHARED_LIBS=OFF -DAOM_TARGET_CPU=generic \
      -DCONFIG_RUNTIME_CPU_DETECT=0 -DCONFIG_WEBM_IO=0 -DENABLE_DOCS=0 -DENABLE_TESTS=0 \
      -DENABLE_EXAMPLES=0 -DENABLE_TOOLS=0 -DAOM_EXTRA_C_FLAGS="$CFLAGS" -DAOM_EXTRA_CXX_FLAGS="$CXXFLAGS" \
    && emmake make -j"$(nproc)" install

FROM base AS opus
RUN fetch https://github.com/xiph/opus.git 3da9f7a6db1c05c3996cb363a9d1931a978bf1be opus
RUN cd opus && ./autogen.sh && emconfigure ./configure --prefix=$PREFIX --host=i686-none \
      --disable-shared --enable-static --disable-extra-programs --disable-doc --disable-asm \
      --disable-rtcd --disable-intrinsics --disable-stack-protector \
    && emmake make -j"$(nproc)" install

FROM base AS libwebp
RUN fetch https://chromium.googlesource.com/webm/libwebp ba8358578ecbc4c75f0723163275de00dec0c704 libwebp
RUN mkdir libwebp/out && cd libwebp/out && emcmake cmake .. -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=$PREFIX -DBUILD_SHARED_LIBS=OFF -DWEBP_BUILD_ANIM_UTILS=OFF \
      -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF \
      -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF \
      -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF \
    && emmake make -j"$(nproc)" install

FROM base AS ffmpeg
COPY --from=zlib $PREFIX $PREFIX
COPY --from=x264 $PREFIX $PREFIX
COPY --from=libvpx $PREFIX $PREFIX
COPY --from=aom $PREFIX $PREFIX
COPY --from=opus $PREFIX $PREFIX
COPY --from=libwebp $PREFIX $PREFIX
# VERSION stands in for the tag, which a shallow fetch doesn't keep.
RUN fetch https://github.com/FFmpeg/FFmpeg.git n9.0.2 ffmpeg && echo n9.0.2 > ffmpeg/VERSION
WORKDIR /src/ffmpeg
ARG FFMPEG_LIBS="--enable-zlib --enable-libx264 --enable-libvpx --enable-libopus --enable-libaom --enable-libwebp"
RUN emconfigure ./configure \
      --target-os=none --arch=wasm --enable-cross-compile \
      --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm \
      --disable-stripping --disable-doc --disable-debug --disable-autodetect \
      --disable-runtime-cpudetect --enable-pthreads --pkg-config-flags=--static \
      --disable-ffprobe --disable-ffplay \
      --enable-gpl --enable-version3 --extra-version=wasm $FFMPEG_LIBS \
      --extra-cflags="$CFLAGS" --extra-ldflags="$LDFLAGS" \
      --extra-ldexeflags="-O3 -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createFFmpeg -sINVOKE_RUN=0 \
        -sEXIT_RUNTIME -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=4 \
        -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB \
        -sSTACK_SIZE=5MB -sDEFAULT_PTHREAD_STACK_SIZE=2MB \
        -sENVIRONMENT=web,worker,node -sEXPORTED_RUNTIME_METHODS=FS,callMain" \
    || (tail -50 ffbuild/config.log; exit 1)
RUN emmake make -j"$(nproc)" ffmpeg_g && mkdir /dist \
    && sed -e s/ffmpeg_g.wasm/ffmpeg.wasm/g -e 's/"ffmpeg_g"/"ffmpeg.mjs"/g' ffmpeg_g > /dist/ffmpeg.mjs && cp ffmpeg_g.wasm /dist/ffmpeg.wasm

# Its threads are std threads, so std is rebuilt with atomics (nightly only).
FROM base AS gifski
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal \
      --default-toolchain nightly-2026-10-28 --component rust-src --target wasm32-unknown-emscripten
RUN fetch https://github.com/ImageOptim/gifski.git 1.34.0 gifski
WORKDIR /src/gifski
# 1.34.0 drops PNG paths on any wasm32 but still uses them; Emscripten has files.
RUN sed -i 's/#\[cfg(all(feature = "png", not(target_arch = "wasm32")))\]/#[cfg(feature = "png")]/' src/collector.rs
RUN RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128 \
      -C link-args=-pthread -C link-args=-sMODULARIZE -C link-args=-sEXPORT_ES6 \
      -C link-args=-sEXPORT_NAME=createGifski -C link-args=-sINVOKE_RUN=0 -C link-args=-sEXIT_RUNTIME \
      -C link-args=-sPROXY_TO_PTHREAD -C link-args=-sPTHREAD_POOL_SIZE=4 \
      -C link-args=-sALLOW_MEMORY_GROWTH -C link-args=-sMAXIMUM_MEMORY=4GB \
      -C link-args=-sDEFAULT_PTHREAD_STACK_SIZE=2MB -C link-args=-sENVIRONMENT=web,worker,node \
      -C link-args=-sEXPORTED_RUNTIME_METHODS=FS,callMain" \
    $HOME/.cargo/bin/cargo build --locked --release -Zbuild-std=std,panic_unwind \
      --target wasm32-unknown-emscripten --bin gifski
RUN mkdir /dist && sed 's/"gifski.js"/"gifski.mjs"/g' target/wasm32-unknown-emscripten/release/gifski.js > /dist/gifski.mjs \
      && cp target/wasm32-unknown-emscripten/release/gifski.wasm /dist/

FROM scratch
COPY --from=ffmpeg /dist /
COPY --from=gifski /dist /
