# Our Odyssey — 作業メモ

- ビルドなしの静的サイト（GitHub Pages）。`main` に入るとそのまま公開される。
- ファイルの役割は README の「つくり」にある。
- **`.js` `.css` につく `?v=` の数字は、`index.html` と `js/` の全ファイルで同じにする。** 何か変えたら、全部まとめて1つ上げる：
  `grep -rl '?v=' index.html js | xargs sed -i -E 's/\.(js|css)\?v=[0-9]+/.\1?v=N/g'`
  一部だけ上げると、同じモジュールが2回読みこまれて（`state.js` のデータが2つに分かれるなど）静かに壊れる。
- `js/` にファイルを足したら、`index.html` の `modulepreload` にも足す。
- 共有の状態は `js/state.js` の `store` / `data`。入れかえるのは `setStore` / `setData` だけ。
- 画面の文言は `tr('日本語', 'English')` で書く。操作ボタンは英語表記。
- `js/config.js` の Supabase 欄を空にすると、お試しモード（その端末の中だけ）で動かせる。
- 変更したら `tests/` の確認を流す（`cd tests && npm install && npm test`、使い方は `tests/README.md`）。画面を変えないはずの変更は、前後を `cmp.sh` でくらべる。
