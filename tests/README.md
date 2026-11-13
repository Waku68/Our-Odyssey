# 動作確認

ヘッドレス Chrome でサイトを開き、全画面と主な操作（追加・編集・削除・写真の編集・地図・気分・設定・バックアップと復元・ログイン・NEW!）を順に流します。本物の Supabase には一切つながりません（お試しモードと、`fake-supabase.js` の代役で動かします）。

```sh
cd tests
npm install            # 初回だけ。Chrome は入っているものを使う（場所は CHROME=/path/to/chrome で指定できる）
npm test               # ../ を流して out/ に各画面の中身（HTML）を書き出す。最後の行が「0 errors」なら通っている
npm run offline        # Service Worker ありで、オフラインでも開き直せるか
npm run lint           # 未定義の名前や、使っていない import がないか
```

## 変更の前後をくらべる

画面を変えないはずの変更（整理・分割など）は、前後の書き出しが同じになることを確かめます。

```sh
git worktree add /tmp/oo-main origin/main
node run.mjs /tmp/oo-main out-base     # 変更前
node run.mjs .. out-new                # 変更後
./cmp.sh out-base out-new              # ちがう画面だけが出る。何も出なければ同じ
```

- `EXTRA=1` をつけると、復元と HOME の写真の入れかえも流す（結果はログに出る）。`SHOTS=1` で画像も残す。`ONLY=ja`（`en` / `live`）で一部だけ。
- `*-15-timeline-detail.html` はタイミングしだいで出たり出なかったりする（スクロール直後のふわっと出す演出）。気にしなくてよい。
