# Native image libraries

The Windows x64 plugin includes unmodified sharp 0.35.5 and the corresponding
`@img/sharp-win32-x64` native module and shared libvips 8.18.7 DLLs. They can be
replaced in `node_modules/` with ABI-compatible builds. The npm package's
`versions.json` lists the component versions used in these binaries.

- sharp source and Apache-2.0 license: https://github.com/lovell/sharp/tree/v0.35.5
- libvips source: https://github.com/libvips/libvips/tree/v8.18.7
- Windows build scripts and corresponding source archives:
  https://github.com/libvips/build-win64-mxe/releases/tag/v8.18.7
- Packaging scripts: https://github.com/lovell/sharp-libvips
- `SHARP-LIBVIPS-NOTICES.md` is copied from the upstream notices at commit
  `da97d5eac80caad3d77950d6ff4cf7c4c125619d`:
  https://github.com/lovell/sharp-libvips/blob/da97d5eac80caad3d77950d6ff4cf7c4c125619d/THIRD-PARTY-NOTICES.md

The installer retains each npm package's license. Its third-party notices cover
libvips dependencies; `LGPL-3.0.txt` and `GPL-3.0.txt` contain the GNU license
texts downloaded from https://www.gnu.org/licenses/.
