# Our Odyssey

ふたりの思い出と記念日をまとめるサイト。

- 見た目のコード：このリポジトリ（GitHub Pages で公開）
- 写真や文章：Supabase（ログインした2人だけが読み書きできる）

`js/config.js` の Supabase 欄が空のあいだは **お試しモード** で動きます。書いた内容はその端末のブラウザにだけ保存され、もう一人とは共有されません。

## できること

- 付き合った日からの日数（開くたびに自動で計算）、月ごとの記念日カウントダウン
- 過ごした場所（地図つき）／好きなもの／行きたいところ／贈ったもの／嫌いなもの
- 行きたいところの「行った！」→ 過ごした場所へ移動
- 価値観：同じお題にふたりそれぞれの答えを並べる
- 記念日を足す、年表
- メンタルの記録（本人だけに見える）と折れ線グラフ
- 写真は載せたい項目にだけ。投稿への「ひとこと」
- 記念日の朝の通知（設定でオン・オフ）、バックアップの保存と、消えた記録の復元

## 本番にする手順

### 1. Supabase を用意する

1. https://supabase.com でアカウントを作り、新しいプロジェクトを作る（Region は Tokyo）。
2. SQL Editor に `supabase/schema.sql` をぜんぶ貼って実行する。
3. Authentication > Users > Add user で、2人分を作る（Auto Confirm User にチェック）。Email には `ログイン名@waku68.github.io`（例：`waku@waku68.github.io`）を入れる。サイトでは `waku` とパスワードだけでログインできる。
4. Authentication の設定で「Allow new users to sign up」をオフにする。**これをしないと、URLを知った他人が登録して中身を読めてしまいます。**
5. Project Settings > API にある Project URL と anon public key を `js/config.js` に入れる。

### 2. 通知を使えるようにする

1. 公開したサイトの `tools/vapid.html` を開いて鍵を作る。公開鍵を `js/config.js` の `VAPID_PUBLIC_KEY` に入れる。
2. Edge Functions で `notify` という名前の関数を作り、`supabase/functions/notify/index.ts` の中身を貼ってデプロイする。「Verify JWT」はオフにする。
3. Edge Functions > Secrets に次を入れる。
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`：手順1で作った鍵
   - `VAPID_SUBJECT`：`mailto:自分のメールアドレス`
   - `CRON_SECRET`：自分で決めた長いランダムな文字列
   - `START_DATE`：`2023-01-28`
4. Database > Extensions で `pg_cron` と `pg_net` を有効にする。
5. `supabase/cron.sql` の `<プロジェクトID>` と `<CRON_SECRET>` を書きかえて SQL Editor で実行する。
6. それぞれのスマホでサイトを開き、設定 > 記念日の通知 をオンにする。iPhone は Safari の共有ボタンから「ホーム画面に追加」して、そのアイコンから開いてオンにする。

通知が届く日：月ごとの記念日、100日ごと、足した記念日の当日・◯年・100日ごと。時刻は朝8時ごろ。

### 気をつけること

- Supabase の無料プランは、1週間使われないとプロジェクトが一時停止します。停止したら管理画面から再開できます。
- 秘密鍵（`VAPID_PRIVATE_KEY`）、`CRON_SECRET`、service role key はこのリポジトリに置かないこと。anon key と VAPID の公開鍵は置いて大丈夫です。
- `assets/` のチューリップの写真は仮のものです。自分たちで撮った写真か、利用が許可されている素材に差し替えてください。

## つくり

ビルドなしの静的サイト。`index.html` / `css/style.css` / `js/` / `sw.js`（通知の受け取りと、オフライン用の控え）。

`js/` の中身：

| ファイル | 役割 |
|---|---|
| `app.js` | 入口。ページを登録して起動する |
| `shell.js` | 骨組み：読みこみ、タブと画面の切りかえ、相手の更新の取りこみ、オフラインの送信待ち、ログイン |
| `pages/` | 画面ごと：`home` `map` `mood` `more` `values` `anniv` `settings` |
| `entries.js` | 記録（場所・好きなもの・贈りもの など）の欄の決まり、カード、詳細、足す・なおす・消す |
| `forms.js` | ダイアログと入力フォーム（日付の帯、写真の欄など） |
| `places.js` `songs.js` `mood-chart.js` `photo-editor.js` | 地図と場所さがし／曲の試聴／気分のグラフ／写真の編集 |
| `seen.js` | NEW! のしるし |
| `state.js` `store.js` | 読みこんだデータ／保存先（Supabase か、お試しモード） |
| `dom.js` `i18n.js` `dates.js` `cats.js` `photos.js` `theme.js` `ask.js` `config.js` | 小さな道具と設定 |

### 更新するとき（`?v=` の数字）

`index.html` と `js/` の中で `.js` `.css` についている `?v=38` は、スマホに新しいファイルを取りに行かせるための番号です。**全部同じ数字にそろえます**（一部だけちがうと、同じファイルが2回読みこまれて中身が食いちがいます）。何か変えたら、まとめて1つ上げます。

```sh
grep -rl '?v=' index.html js | xargs sed -i -E 's/\.(js|css)\?v=[0-9]+/.\1?v=39/g'
```

`js/` にファイルを足したときは、`index.html` の `modulepreload` の並びにも足します。

### 動作確認

`tests/` に、ヘッドレス Chrome で全画面と主な操作を流す確認用のスクリプトがあります（本物の Supabase にはつながりません）。使い方は `tests/README.md`。
